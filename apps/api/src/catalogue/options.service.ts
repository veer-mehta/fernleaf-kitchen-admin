import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Paged } from "@fernleaf/shared";
import { DomainError } from "../common/domain-error";
import { isRecordNotFound } from "../common/prisma-errors";
import { PricingService } from "../pricing/pricing.service";
import { PrismaService } from "../prisma/prisma.service";
import { assertReferencesExist, toJoinRows } from "./references";

const include = {
  allergens: { include: { allergen: true } },
  dietaryTags: { include: { dietaryTag: true } },
  portions: { include: { portionSize: true } },
} satisfies Prisma.OptionInclude;

function toOption(o: Prisma.OptionGetPayload<{ include: typeof include }>) {
  return {
    id: o.id,
    name: o.name,
    costCents: o.costCents,
    active: o.active,
    allergens: o.allergens.map((a) => ({ id: a.allergen.id, name: a.allergen.name })),
    dietaryTags: o.dietaryTags.map((t) => ({ id: t.dietaryTag.id, name: t.dietaryTag.name })),
    portionSizes: o.portions.map((p) => ({ id: p.portionSize.id, name: p.portionSize.name })),
  };
}

interface OptionFields {
  name?: string;
  costCents?: number;
  active?: boolean;
  allergenIds?: number[];
  dietaryTagIds?: number[];
  portionSizeIds?: number[];
}

@Injectable()
export class OptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  async list(q: { page: number; pageSize: number; search?: string; active?: "true" | "false" }): Promise<Paged<unknown>> {
    const where: Prisma.OptionWhereInput = {
      active: q.active ? q.active === "true" : undefined,
      name: q.search ? { contains: q.search, mode: "insensitive" } : undefined,
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.option.findMany({
        where,
        include,
        orderBy: { name: "asc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.option.count({ where }),
    ]);
    return { items: rows.map(toOption), total };
  }

  async create(input: OptionFields & { name: string; costCents: number }) {
    await assertReferencesExist(this.prisma, input);
    const option = await this.prisma.option.create({
      data: {
        name: input.name,
        costCents: input.costCents,
        allergens: { create: toJoinRows("allergenId", input.allergenIds ?? []) },
        dietaryTags: { create: toJoinRows("dietaryTagId", input.dietaryTagIds ?? []) },
        portions: { create: toJoinRows("portionSizeId", input.portionSizeIds ?? []) },
      },
      include,
    });
    await this.pricing.recomputeAll();
    return toOption(option);
  }

  async update(id: number, input: OptionFields) {
    await assertReferencesExist(this.prisma, input);
    try {
      const option = await this.prisma.option.update({
        where: { id },
        data: {
          name: input.name,
          costCents: input.costCents,
          active: input.active,
          allergens: input.allergenIds
            ? { deleteMany: {}, create: toJoinRows("allergenId", input.allergenIds) }
            : undefined,
          dietaryTags: input.dietaryTagIds
            ? { deleteMany: {}, create: toJoinRows("dietaryTagId", input.dietaryTagIds) }
            : undefined,
          portions: input.portionSizeIds
            ? { deleteMany: {}, create: toJoinRows("portionSizeId", input.portionSizeIds) }
            : undefined,
        },
        include,
      });
      if (input.costCents !== undefined) await this.pricing.recomputeAll();
      return toOption(option);
    } catch (e) {
      if (isRecordNotFound(e)) throw new DomainError("NOT_FOUND", "Option not found", 404);
      throw e;
    }
  }
}
