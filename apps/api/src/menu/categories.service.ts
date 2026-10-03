import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { DomainError } from "../common/domain-error";
import { isRecordNotFound } from "../common/prisma-errors";
import { PrismaService } from "../prisma/prisma.service";

const include = {
  items: { orderBy: [{ displayOrder: "asc" }, { id: "asc" }], include: { dish: true } },
} satisfies Prisma.CategoryInclude;

function toCategory(c: Prisma.CategoryGetPayload<{ include: typeof include }>) {
  return {
    id: c.id,
    name: c.name,
    displayOrder: c.displayOrder,
    active: c.active,
    isSecret: c.isSecret,
    items: c.items.map((i) => ({
      dishId: i.dishId,
      sku: i.dish.sku,
      name: i.dish.name,
      active: i.active,
      displayOrder: i.displayOrder,
    })),
  };
}

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const categories = await this.prisma.category.findMany({
      include,
      orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
    });
    return categories.map(toCategory);
  }

  async create(input: { name: string; isSecret: boolean; active: boolean }) {
    // New categories go to the end of the list.
    const last = await this.prisma.category.aggregate({ _max: { displayOrder: true } });
    const category = await this.prisma.category.create({
      data: { ...input, displayOrder: (last._max.displayOrder ?? -1) + 1 },
      include,
    });
    return toCategory(category);
  }

  async update(id: number, input: { name?: string; isSecret?: boolean; active?: boolean }) {
    try {
      return toCategory(await this.prisma.category.update({ where: { id }, data: input, include }));
    } catch (e) {
      throw this.translate(e);
    }
  }

  async remove(id: number) {
    try {
      // Items and company-hiding rows are removed by the database (onDelete: Cascade).
      await this.prisma.category.delete({ where: { id } });
      return { ok: true };
    } catch (e) {
      throw this.translate(e);
    }
  }

  // Sets the display order of the listed categories to their position in the list.
  async reorder(ids: number[]) {
    const found = await this.prisma.category.count({ where: { id: { in: ids } } });
    if (found !== ids.length) {
      throw new DomainError("INVALID_REFERENCE", "One of the categories does not exist", 400, {
        ids: "One of the categories does not exist",
      });
    }
    await this.prisma.$transaction(
      ids.map((id, index) => this.prisma.category.update({ where: { id }, data: { displayOrder: index } })),
    );
    return this.list();
  }

  // Replaces the dishes in a category with the list given (position = display order).
  async replaceItems(id: number, items: { dishId: number; active: boolean }[]) {
    if (!(await this.prisma.category.findUnique({ where: { id } }))) {
      throw new DomainError("NOT_FOUND", "Category not found", 404);
    }
    const dishIds = items.map((i) => i.dishId);
    const known = new Set(
      (await this.prisma.dish.findMany({ where: { id: { in: dishIds } }, select: { id: true } })).map((d) => d.id),
    );
    const fields: Record<string, string> = {};
    items.forEach((item, i) => {
      if (!known.has(item.dishId)) fields[`items.${i}.dishId`] = "That dish does not exist";
    });
    if (Object.keys(fields).length > 0) {
      throw new DomainError("INVALID_REFERENCE", "Some dishes do not exist", 400, fields);
    }

    await this.prisma.$transaction([
      this.prisma.categoryItem.deleteMany({ where: { categoryId: id } }),
      this.prisma.categoryItem.createMany({
        data: items.map((item, index) => ({ categoryId: id, dishId: item.dishId, active: item.active, displayOrder: index })),
      }),
    ]);
    const category = await this.prisma.category.findUniqueOrThrow({ where: { id }, include });
    return toCategory(category);
  }

  private translate(e: unknown): unknown {
    if (isRecordNotFound(e)) return new DomainError("NOT_FOUND", "Category not found", 404);
    return e;
  }
}
