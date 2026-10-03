import { PrismaService } from "../../src/prisma/prisma.service";

// Small builders for test data, written straight to the database (bypassing the API) so each
// test can set up exactly the situation it needs in one or two lines.
export function fixtures(prisma: PrismaService) {
  let counter = 0;
  const next = () => ++counter;

  return {
    tier: (name: string, isDefault = false) => prisma.priceTier.create({ data: { name, isDefault } }),

    company: (data: { name?: string; priceTierId?: number | null; workingDays?: number[] } = {}) =>
      prisma.company.create({
        data: {
          name: data.name ?? `Company ${next()}`,
          priceTierId: data.priceTierId ?? null,
          workingDays: data.workingDays,
        },
      }),

    employee: (companyId: number, email?: string, flags: { canChooseAddress?: boolean; canChangeTime?: boolean; canChangePackaging?: boolean } = {}) =>
      prisma.employee.create({
        data: { companyId, email: email ?? `emp${next()}@acme.com`, name: "Employee", ...flags },
      }),

    address: (companyId: number, label = "HQ") =>
      prisma.companyAddress.create({
        data: { companyId, label, line1: `${label} Street 1`, city: "Pune", postalCode: "411001" },
      }),

    domain: (companyId: number, domain: string) => prisma.companyDomain.create({ data: { companyId, domain } }),

    dish: (sku: string, over: { costCents?: number; active?: boolean; minOrderQty?: number } = {}) =>
      prisma.dish.create({
        data: { sku, name: `Dish ${sku}`, temperature: "HOT", costCents: over.costCents ?? 100, ...over },
      }),

    option: (name: string, over: { costCents?: number; active?: boolean } = {}) =>
      prisma.option.create({ data: { name, costCents: over.costCents ?? 10, active: over.active } }),

    dishPrice: (tierId: number, dishId: number, cents: number) =>
      prisma.dishPrice.create({ data: { tierId, dishId, cents } }),

    optionPrice: (tierId: number, optionId: number, cents: number) =>
      prisma.optionPrice.create({ data: { tierId, optionId, cents } }),

    category: (name: string, over: { isSecret?: boolean; active?: boolean; displayOrder?: number } = {}) =>
      prisma.category.create({ data: { name, ...over } }),

    categoryItem: (categoryId: number, dishId: number, over: { displayOrder?: number; active?: boolean } = {}) =>
      prisma.categoryItem.create({ data: { categoryId, dishId, ...over } }),

    // A group on a dish offering the given options in order.
    group: (dishId: number, name: string, required: boolean, optionIds: number[], displayOrder = 0) =>
      prisma.optionGroup.create({
        data: {
          dishId,
          name,
          required,
          displayOrder,
          items: { create: optionIds.map((optionId, i) => ({ optionId, displayOrder: i })) },
        },
      }),

    hideCategory: (companyId: number, categoryId: number) =>
      prisma.companyHiddenCategory.create({ data: { companyId, categoryId } }),

    hideDish: (companyId: number, dishId: number) =>
      prisma.companyHiddenDish.create({ data: { companyId, dishId } }),
  };
}
