import { Injectable } from "@nestjs/common";
import { DomainError } from "../common/domain-error";
import { PrismaService } from "../prisma/prisma.service";
import { DishesService } from "./dishes.service";

export interface GroupInput {
  name: string;
  required: boolean;
  usesPortions: boolean;
  optionIds: number[];
  portions: { portionSizeId: number; extraCents: number }[];
}

@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dishes: DishesService,
  ) {}

  // Replaces ALL of a dish's option groups with the list given. The position in the array
  // becomes the display order. Validation happens first, then one transaction writes
  // everything, so a bad request never leaves a half-saved dish.
  async replace(dishId: number, groups: GroupInput[]) {
    if (!(await this.prisma.dish.findUnique({ where: { id: dishId } }))) {
      throw new DomainError("NOT_FOUND", "Dish not found", 404);
    }
    await this.assertOptionsAndPortionsExist(groups);

    await this.prisma.$transaction(async (tx) => {
      await tx.optionGroup.deleteMany({ where: { dishId } }); // items and portions cascade
      for (const [index, group] of groups.entries()) {
        await tx.optionGroup.create({
          data: {
            dishId,
            name: group.name,
            required: group.required,
            usesPortions: group.usesPortions,
            displayOrder: index,
            items: {
              create: group.optionIds.map((optionId, i) => ({ optionId, displayOrder: i })),
            },
            portions: { create: group.portions },
          },
        });
      }
    });

    return this.dishes.findOne(dishId);
  }

  private async assertOptionsAndPortionsExist(groups: GroupInput[]) {
    const optionIds = [...new Set(groups.flatMap((g) => g.optionIds))];
    const portionIds = [...new Set(groups.flatMap((g) => g.portions.map((p) => p.portionSizeId)))];
    const [options, sizes] = await Promise.all([
      this.prisma.option.findMany({ where: { id: { in: optionIds } }, select: { id: true } }),
      this.prisma.portionSize.findMany({ where: { id: { in: portionIds } }, select: { id: true } }),
    ]);
    const knownOptions = new Set(options.map((o) => o.id));
    const knownSizes = new Set(sizes.map((s) => s.id));

    // Field keys like "groups.0.optionIds" match the zod error paths, so the form can
    // show the message next to the right group.
    const fields: Record<string, string> = {};
    groups.forEach((group, i) => {
      if (group.optionIds.some((id) => !knownOptions.has(id))) {
        fields[`groups.${i}.optionIds`] = "One of the options does not exist";
      }
      if (group.portions.some((p) => !knownSizes.has(p.portionSizeId))) {
        fields[`groups.${i}.portions`] = "One of the portion sizes does not exist";
      }
    });
    if (Object.keys(fields).length > 0) {
      throw new DomainError("INVALID_REFERENCE", "Some selected items do not exist", 400, fields);
    }
  }
}
