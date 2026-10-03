import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Paged } from "@fernleaf/shared";
import { DomainError } from "../common/domain-error";
import { isRecordNotFound, isUniqueViolation } from "../common/prisma-errors";
import { PricingService } from "../pricing/pricing.service";
import { PrismaService } from "../prisma/prisma.service";
import { assertReferencesExist, toJoinRows } from "./references";

// Everything a dish screen needs, loaded in one query. Groups and their options keep their order.
const detailInclude = {
  station: true,
  allergens: { include: { allergen: true } },
  dietaryTags: { include: { dietaryTag: true } },
  groups: {
    orderBy: { displayOrder: "asc" },
    include: {
      items: { orderBy: { displayOrder: "asc" }, include: { option: true } },
      portions: { include: { portionSize: true }, orderBy: [{ extraCents: "asc" }, { portionSizeId: "asc" }] },
    },
  },
} satisfies Prisma.DishInclude;

type DishWithDetail = Prisma.DishGetPayload<{ include: typeof detailInclude }>;

// Flattens Prisma's nested join rows into the shape the API returns.
function toDetail(d: DishWithDetail) {
  return {
    id: d.id,
    sku: d.sku,
    name: d.name,
    description: d.description,
    imageUrl: d.imageUrl,
    temperature: d.temperature,
    costCents: d.costCents,
    stationId: d.stationId,
    station: d.station ? { id: d.station.id, name: d.station.name } : null,
    minOrderQty: d.minOrderQty,
    active: d.active,
    allergens: d.allergens.map((a) => ({ id: a.allergen.id, name: a.allergen.name })),
    dietaryTags: d.dietaryTags.map((t) => ({ id: t.dietaryTag.id, name: t.dietaryTag.name })),
    groups: d.groups.map((g) => ({
      id: g.id,
      name: g.name,
      required: g.required,
      displayOrder: g.displayOrder,
      usesPortions: g.usesPortions,
      options: g.items.map((i) => ({
        id: i.option.id,
        name: i.option.name,
        costCents: i.option.costCents,
        active: i.option.active,
      })),
      portions: g.portions.map((p) => ({ portionSizeId: p.portionSizeId, name: p.portionSize.name, extraCents: p.extraCents })),
    })),
  };
}

export interface DishListFilters {
  page: number;
  pageSize: number;
  search?: string;
  active?: "true" | "false";
  stationId?: number;
}

interface DishFields {
  sku?: string;
  name?: string;
  description?: string;
  imageUrl?: string | null;
  temperature?: "HOT" | "COLD";
  costCents?: number;
  stationId?: number | null;
  minOrderQty?: number | null;
  allergenIds?: number[];
  dietaryTagIds?: number[];
}

@Injectable()
export class DishesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  async list(filters: DishListFilters): Promise<Paged<unknown>> {
    const where: Prisma.DishWhereInput = {
      active: filters.active ? filters.active === "true" : undefined,
      stationId: filters.stationId,
      OR: filters.search
        ? [
            { name: { contains: filters.search, mode: "insensitive" } },
            { sku: { contains: filters.search, mode: "insensitive" } },
          ]
        : undefined,
    };
    // Two queries in one transaction: this page of rows, and the total for the pager.
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.dish.findMany({
        where,
        include: { station: true },
        orderBy: { name: "asc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.dish.count({ where }),
    ]);
    const items = rows.map((d) => ({
      id: d.id,
      sku: d.sku,
      name: d.name,
      temperature: d.temperature,
      costCents: d.costCents,
      station: d.station ? { id: d.station.id, name: d.station.name } : null,
      minOrderQty: d.minOrderQty,
      active: d.active,
    }));
    return { items, total };
  }

  async findOne(id: number) {
    const dish = await this.prisma.dish.findUnique({ where: { id }, include: detailInclude });
    if (!dish) throw new DomainError("NOT_FOUND", "Dish not found", 404);
    return toDetail(dish);
  }

  async create(input: DishFields & { sku: string; name: string; temperature: "HOT" | "COLD"; costCents: number }) {
    await assertReferencesExist(this.prisma, input);
    try {
      const dish = await this.prisma.dish.create({
        data: {
          sku: input.sku,
          name: input.name,
          description: input.description,
          imageUrl: input.imageUrl,
          temperature: input.temperature,
          costCents: input.costCents,
          stationId: input.stationId,
          minOrderQty: input.minOrderQty,
          allergens: { create: toJoinRows("allergenId", input.allergenIds ?? []) },
          dietaryTags: { create: toJoinRows("dietaryTagId", input.dietaryTagIds ?? []) },
        },
        include: detailInclude,
      });
      await this.pricing.recomputeAll(); // cost-based tiers price the new dish straight away
      return toDetail(dish);
    } catch (e) {
      throw this.translate(e);
    }
  }

  async update(id: number, input: DishFields) {
    await assertReferencesExist(this.prisma, input);
    try {
      const dish = await this.prisma.dish.update({
        where: { id },
        data: {
          sku: input.sku,
          name: input.name,
          description: input.description,
          imageUrl: input.imageUrl,
          temperature: input.temperature,
          costCents: input.costCents,
          stationId: input.stationId,
          minOrderQty: input.minOrderQty,
          // When a list is sent it replaces the old one; when omitted the old one stays.
          allergens: input.allergenIds
            ? { deleteMany: {}, create: toJoinRows("allergenId", input.allergenIds) }
            : undefined,
          dietaryTags: input.dietaryTagIds
            ? { deleteMany: {}, create: toJoinRows("dietaryTagId", input.dietaryTagIds) }
            : undefined,
        },
        include: detailInclude,
      });
      if (input.costCents !== undefined) await this.pricing.recomputeAll(); // derived prices follow the cost
      return toDetail(dish);
    } catch (e) {
      throw this.translate(e);
    }
  }

  // Dishes are never deleted (old orders point at them), only switched off and on.
  async setActive(id: number, active: boolean) {
    try {
      const dish = await this.prisma.dish.update({ where: { id }, data: { active }, include: detailInclude });
      return toDetail(dish);
    } catch (e) {
      throw this.translate(e);
    }
  }

  private translate(e: unknown): unknown {
    if (isUniqueViolation(e)) {
      return new DomainError("SKU_TAKEN", "That SKU is already used by another dish", 409, {
        sku: "That SKU is already used by another dish",
      });
    }
    if (isRecordNotFound(e)) return new DomainError("NOT_FOUND", "Dish not found", 404);
    return e;
  }
}
