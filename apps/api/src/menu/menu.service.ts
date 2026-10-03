import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { DomainError } from "../common/domain-error";
import { PrismaService } from "../prisma/prisma.service";

export interface MenuOption {
  optionId: number;
  name: string;
  priceCents: number;
  allergens: string[];
  dietaryTags: string[];
}
export interface MenuGroup {
  groupId: number;
  name: string;
  required: boolean;
  displayOrder: number;
  usesPortions: boolean;
  options: MenuOption[];
}
export interface MenuDish {
  dishId: number;
  sku: string;
  name: string;
  description: string;
  imageUrl: string | null;
  temperature: "HOT" | "COLD";
  priceCents: number;
  minOrderQty: number | null;
  allergens: string[];
  dietaryTags: string[];
  groups: MenuGroup[];
}
export interface Menu {
  tierId: number | null;
  categories: { id: number; name: string; order: number; dishes: MenuDish[] }[];
  secretDishes: MenuDish[]; // not listed to the employee, but orderable by id or search
}

const byOrder = [{ displayOrder: "asc" as const }, { id: "asc" as const }];

// Everything needed to build one menu dish, with prices already narrowed to the employee's tier
// (`prices: { where: { tierId } }` means each row carries at most one price).
const dishInclude = (tierId: number) =>
  ({
    prices: { where: { tierId } },
    allergens: { include: { allergen: true } },
    dietaryTags: { include: { dietaryTag: true } },
    groups: {
      orderBy: byOrder,
      include: {
        items: {
          orderBy: { displayOrder: "asc" },
          include: {
            option: {
              include: {
                prices: { where: { tierId } },
                allergens: { include: { allergen: true } },
                dietaryTags: { include: { dietaryTag: true } },
              },
            },
          },
        },
      },
    },
  }) satisfies Prisma.DishInclude;

type DishRow = Prisma.DishGetPayload<{ include: ReturnType<typeof dishInclude> }>;

// This is the single place that decides what an employee may order. The preview screen and
// order validation both call it, so what staff preview is exactly what the server enforces.
@Injectable()
export class MenuService {
  constructor(private readonly prisma: PrismaService) {}

  async forEmployee(employeeId: number): Promise<Menu> {
    const ctx = await this.context(employeeId);
    if (ctx.tierId === null) return { tierId: null, categories: [], secretDishes: [] };
    const tierId = ctx.tierId;

    const categories = await this.prisma.category.findMany({
      // A hidden category takes its items with it, for this company only.
      where: { active: true, id: { notIn: ctx.hiddenCategoryIds } },
      orderBy: byOrder,
      include: {
        items: {
          where: {
            active: true,
            dishId: { notIn: ctx.hiddenDishIds },
            // A dish with no price on the tier is not on the menu at all (not $0, not blank).
            dish: { active: true, prices: { some: { tierId } } },
          },
          orderBy: byOrder,
          include: { dish: { include: dishInclude(tierId) } },
        },
      },
    });

    const listed: Menu["categories"] = [];
    const secret = new Map<number, MenuDish>();
    for (const category of categories) {
      const dishes = category.items.map((item) => this.shapeDish(item.dish)).filter((d) => d !== null);
      if (category.isSecret) {
        for (const dish of dishes) secret.set(dish.dishId, dish);
      } else if (dishes.length > 0) {
        listed.push({ id: category.id, name: category.name, order: category.displayOrder, dishes });
      }
    }
    return { tierId, categories: listed, secretDishes: [...secret.values()] };
  }

  // Looks up one dish exactly as the employee would see it (listed OR secret), or null if they
  // could not order it. Used by order validation, so a hand-crafted request cannot add a dish
  // the menu would never have shown.
  async findDishForEmployee(employeeId: number, dishId: number): Promise<MenuDish | null> {
    const ctx = await this.context(employeeId);
    if (ctx.tierId === null || ctx.hiddenDishIds.includes(dishId)) return null;
    const tierId = ctx.tierId;

    const dish = await this.prisma.dish.findFirst({
      where: {
        id: dishId,
        active: true,
        prices: { some: { tierId } },
        // It must sit in at least one active, non-hidden category (secret ones count).
        categoryItems: {
          some: { active: true, category: { active: true, id: { notIn: ctx.hiddenCategoryIds } } },
        },
      },
      include: dishInclude(tierId),
    });
    return dish ? this.shapeDish(dish) : null;
  }

  // The employee's price tier plus what their company hides.
  private async context(employeeId: number) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: { company: { include: { hiddenCategories: true, hiddenDishes: true } } },
    });
    if (!employee) throw new DomainError("NOT_FOUND", "Employee not found", 404);

    // Company's own tier, otherwise the default tier. No tiers at all = nothing to sell.
    const defaultTier = employee.company.priceTierId
      ? null
      : await this.prisma.priceTier.findFirst({ where: { isDefault: true } });
    return {
      tierId: employee.company.priceTierId ?? defaultTier?.id ?? null,
      hiddenCategoryIds: employee.company.hiddenCategories.map((h) => h.categoryId),
      hiddenDishIds: employee.company.hiddenDishes.map((h) => h.dishId),
    };
  }

  // Turns a database row into a menu dish. Returns null when a REQUIRED group has no option
  // the employee can pick (the dish could never be ordered validly, so it is hidden).
  private shapeDish(dish: DishRow): MenuDish | null {
    const price = dish.prices[0]?.cents;
    if (price === undefined) return null;

    const groups: MenuGroup[] = [];
    for (const group of dish.groups) {
      const options: MenuOption[] = group.items
        .map((item) => item.option)
        .filter((option) => option.active && option.prices.length > 0)
        .map((option) => ({
          optionId: option.id,
          name: option.name,
          priceCents: option.prices[0].cents,
          allergens: option.allergens.map((a) => a.allergen.name),
          dietaryTags: option.dietaryTags.map((t) => t.dietaryTag.name),
        }));

      if (options.length === 0) {
        if (group.required) return null;
        continue; // an optional group with nothing to offer simply isn't shown
      }
      groups.push({
        groupId: group.id,
        name: group.name,
        required: group.required,
        displayOrder: group.displayOrder,
        usesPortions: group.usesPortions,
        options,
      });
    }

    return {
      dishId: dish.id,
      sku: dish.sku,
      name: dish.name,
      description: dish.description,
      imageUrl: dish.imageUrl,
      temperature: dish.temperature,
      priceCents: price,
      minOrderQty: dish.minOrderQty,
      allergens: dish.allergens.map((a) => a.allergen.name),
      dietaryTags: dish.dietaryTags.map((t) => t.dietaryTag.name),
      groups,
    };
  }
}
