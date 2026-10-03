import { PrismaClient } from "@prisma/client";
import { ceilDivTo5 } from "@fernleaf/shared";
import { derivePrice } from "../pricing/tier-derivation";
import { ALLERGENS, CATEGORIES, COMPANIES, DIETARY_TAGS, DISHES, GROUPS, OPTIONS, PORTION_SIZES, PRICE_OVERRIDES, STATIONS, TIERS } from "./demo-data";

const named = <T extends { id: number; name: string }>(rows: T[]) => new Map(rows.map((r) => [r.name, r.id]));
const join = <K extends string>(key: K, ids: (number | undefined)[]) => ids.filter((i): i is number => i !== undefined).map((id) => ({ [key]: id }) as Record<K, number>);

// Creates (or brings up to date) the demo menu, price tiers and companies. Safe to run any number of times:
// every row is found by its natural key (SKU, name, email, domain) and updated rather than duplicated.
export async function seedDemoCatalogue(prisma: PrismaClient) {
  // ---- reference lists ----
  for (const name of ALLERGENS) await prisma.allergen.upsert({ where: { name }, update: {}, create: { name } });
  for (const name of DIETARY_TAGS) await prisma.dietaryTag.upsert({ where: { name }, update: {}, create: { name } });
  for (const name of STATIONS) await prisma.kitchenStation.upsert({ where: { name }, update: {}, create: { name } });
  for (const name of PORTION_SIZES) await prisma.portionSize.upsert({ where: { name }, update: {}, create: { name } });
  const allergenId = named(await prisma.allergen.findMany());
  const tagId = named(await prisma.dietaryTag.findMany());
  const stationId = named(await prisma.kitchenStation.findMany());
  const sizeId = named(await prisma.portionSize.findMany());

  // ---- options ----
  const optionIds = new Map<string, number>();
  for (const def of OPTIONS) {
    const existing = await prisma.option.findFirst({ where: { name: def.name } });
    const data = {
      name: def.name,
      costCents: def.costCents,
      active: true,
      allergens: { deleteMany: {}, create: join("allergenId", (def.allergens ?? []).map((a) => allergenId.get(a))) },
      dietaryTags: { deleteMany: {}, create: join("dietaryTagId", (def.tags ?? []).map((t) => tagId.get(t))) },
      portions: { deleteMany: {}, create: join("portionSizeId", (def.sizes ?? []).map((n) => sizeId.get(n))) },
    };
    const option = existing
      ? await prisma.option.update({ where: { id: existing.id }, data })
      : await prisma.option.create({ data: { ...data, allergens: { create: data.allergens.create }, dietaryTags: { create: data.dietaryTags.create }, portions: { create: data.portions.create } } });
    optionIds.set(def.key, option.id);
  }

  // ---- dishes and their choice groups ----
  const dishIds = new Map<string, number>();
  for (const def of DISHES) {
    const data = {
      name: def.name, description: def.description, temperature: def.temperature, costCents: def.costCents, active: true,
      stationId: stationId.get(def.station) ?? null, minOrderQty: def.minOrderQty ?? null,
    };
    const dish = await prisma.dish.upsert({
      where: { sku: def.sku },
      update: {
        ...data,
        allergens: { deleteMany: {}, create: join("allergenId", (def.allergens ?? []).map((a) => allergenId.get(a))) },
        dietaryTags: { deleteMany: {}, create: join("dietaryTagId", (def.tags ?? []).map((t) => tagId.get(t))) },
      },
      create: {
        sku: def.sku, ...data,
        allergens: { create: join("allergenId", (def.allergens ?? []).map((a) => allergenId.get(a))) },
        dietaryTags: { create: join("dietaryTagId", (def.tags ?? []).map((t) => tagId.get(t))) },
      },
    });
    dishIds.set(def.sku, dish.id);

    // Option groups: only rewritten when they differ, so their ids (which saved order drafts refer to) stay stable.
    const wanted = (def.groups ?? []).map((g) => ({
      ...GROUPS[g],
      optionIds: GROUPS[g].options.map((o) => optionIds.get(o)!),
      portions: (GROUPS[g].portions ?? []).map((p) => ({ portionSizeId: sizeId.get(p.size)!, extraCents: p.extraCents })).sort((a, b) => a.portionSizeId - b.portionSizeId),
    }));
    const current = await prisma.optionGroup.findMany({ where: { dishId: dish.id }, orderBy: { displayOrder: "asc" }, include: { items: { orderBy: { displayOrder: "asc" } }, portions: true } });
    const signature = (gs: { name: string; required: boolean; optionIds: number[]; portions: { portionSizeId: number; extraCents: number }[] }[]) =>
      JSON.stringify(gs.map((g) => [g.name, g.required, g.optionIds, g.portions.map((p) => [p.portionSizeId, p.extraCents])]));
    const same = signature(current.map((g) => ({
      name: g.name, required: g.required, optionIds: g.items.map((i) => i.optionId),
      portions: [...g.portions].sort((a, b) => a.portionSizeId - b.portionSizeId).map((p) => ({ portionSizeId: p.portionSizeId, extraCents: p.extraCents })),
    }))) === signature(wanted);
    if (!same) {
      await prisma.optionGroup.deleteMany({ where: { dishId: dish.id } });
      for (const [index, g] of wanted.entries()) {
        await prisma.optionGroup.create({
          data: {
            dishId: dish.id, name: g.name, required: g.required, displayOrder: index, usesPortions: g.portions.length > 0,
            items: { create: g.optionIds.map((optionId, i) => ({ optionId, displayOrder: i })) }, portions: { create: g.portions },
          },
        });
      }
    }
  }

  // ---- categories ----
  for (const [order, def] of CATEGORIES.entries()) {
    const existing = await prisma.category.findFirst({ where: { name: def.name } });
    const data = { name: def.name, displayOrder: order, active: true, isSecret: def.secret ?? false };
    const category = existing ? await prisma.category.update({ where: { id: existing.id }, data }) : await prisma.category.create({ data });
    const inCategory = DISHES.filter((d) => d.category === def.name);
    for (const [i, dish] of inCategory.entries()) {
      await prisma.categoryItem.upsert({
        where: { categoryId_dishId: { categoryId: category.id, dishId: dishIds.get(dish.sku)! } },
        update: { displayOrder: i, active: true },
        create: { categoryId: category.id, dishId: dishIds.get(dish.sku)!, displayOrder: i },
      });
    }
  }

  // ---- price tiers and prices ----
  const standard = await upsertTier(prisma, { name: TIERS.standard.name, derivationType: "COST_MULTIPLE", multiplierMilli: TIERS.standard.multiplierMilli });
  const enterprise = await upsertTier(prisma, { name: TIERS.enterprise.name, derivationType: "TIER_PERCENT", percentBp: TIERS.enterprise.percentBp, baseTierId: standard.id });
  const partner = await upsertTier(prisma, { name: TIERS.partner.name, derivationType: "NONE" });
  // The first tier is the default, but never take the default away from a tier someone chose themselves.
  if ((await prisma.priceTier.count({ where: { isDefault: true } })) === 0) await prisma.priceTier.update({ where: { id: standard.id }, data: { isDefault: true } });

  const costOfDish = new Map(DISHES.map((d) => [d.sku, d.costCents]));
  const standardRule = { type: "COST_MULTIPLE" as const, multiplierMilli: TIERS.standard.multiplierMilli };
  const enterpriseRule = { type: "TIER_PERCENT" as const, percentBp: TIERS.enterprise.percentBp };
  const overrideOf = (tier: "standard" | "enterprise", sku: string) => PRICE_OVERRIDES.find((o) => o.tier === tier && o.sku === sku)?.cents;

  const setDishPrice = (tierId: number, sku: string, cents: number, isOverride: boolean) =>
    prisma.dishPrice.upsert({
      where: { tierId_dishId: { tierId, dishId: dishIds.get(sku)! } },
      update: { cents, isOverride }, create: { tierId, dishId: dishIds.get(sku)!, cents, isOverride },
    });
  for (const [sku, cost] of costOfDish) {
    const std = overrideOf("standard", sku) ?? derivePrice(standardRule, { costCents: cost })!;
    await setDishPrice(standard.id, sku, std, overrideOf("standard", sku) !== undefined);
    const ent = overrideOf("enterprise", sku) ?? derivePrice(enterpriseRule, { costCents: cost, basePriceCents: std })!;
    await setDishPrice(enterprise.id, sku, ent, overrideOf("enterprise", sku) !== undefined);
    if (TIERS.partner.skipSkus.includes(sku)) {
      await prisma.dishPrice.deleteMany({ where: { tierId: partner.id, dishId: dishIds.get(sku)! } });
    } else {
      await setDishPrice(partner.id, sku, ceilDivTo5(std * TIERS.partner.factorPercent, 100), true); // typed by hand
    }
  }
  for (const def of OPTIONS) {
    const optionId = optionIds.get(def.key)!;
    const std = derivePrice(standardRule, { costCents: def.costCents })!;
    const ent = derivePrice(enterpriseRule, { costCents: def.costCents, basePriceCents: std })!;
    const put = (tierId: number, cents: number, isOverride: boolean) =>
      prisma.optionPrice.upsert({ where: { tierId_optionId: { tierId, optionId } }, update: { cents, isOverride }, create: { tierId, optionId, cents, isOverride } });
    await put(standard.id, std, false);
    await put(enterprise.id, ent, false);
    await put(partner.id, ceilDivTo5(std * TIERS.partner.factorPercent, 100), true);
  }

  // ---- companies and employees ----
  const tierByKey = { standard: standard.id, enterprise: enterprise.id, partner: partner.id };
  const driver = await prisma.staff.findUnique({ where: { email: "driver@test.com" } });
  const categoryId = named(await prisma.category.findMany());

  for (const def of COMPANIES) {
    const fields = {
      priceTierId: def.tier === "standard" ? null : tierByKey[def.tier], // Standard is the default tier, so "no tier"
      billingContactName: def.billing.name, billingContactEmail: def.billing.email, billingContactPhone: def.billing.phone,
      workingDays: def.workingDays, deliveryTime: def.deliveryTime, deliveryMinutes: def.deliveryMinutes,
      defaultPackaging: def.packaging, driverInstructions: def.instructions,
      defaultDriverId: def.defaultDriver ? (driver?.id ?? null) : null,
    };
    const company = await prisma.company.upsert({ where: { name: def.name }, update: fields, create: { name: def.name, ...fields } });
    await prisma.companyDomain.upsert({ where: { domain: def.domain }, update: {}, create: { companyId: company.id, domain: def.domain } });
    if ((await prisma.companyAddress.count({ where: { companyId: company.id } })) === 0) {
      await prisma.companyAddress.createMany({ data: def.addresses.map((a) => ({ companyId: company.id, label: a.label, line1: a.line1, city: a.city, postalCode: a.postalCode, instructions: a.instructions ?? "" })) });
    }

    let ownerId: number | undefined;
    for (const [i, e] of def.employees.entries()) {
      const email = `${e.name.toLowerCase().replace(/[^a-z ]/g, "").replace(/ /g, ".")}@${def.domain}`;
      const flags = { canChooseAddress: e.canChooseAddress ?? false, canChangeTime: e.canChangeTime ?? false, canChangePackaging: e.canChangePackaging ?? false };
      const employee = await prisma.employee.upsert({
        where: { email },
        update: { name: e.name, companyId: company.id, active: true, ...flags,
          allergens: { deleteMany: {}, create: join("allergenId", (e.allergens ?? []).map((a) => allergenId.get(a))) },
          dietaryTags: { deleteMany: {}, create: join("dietaryTagId", (e.tags ?? []).map((t) => tagId.get(t))) } },
        create: { email, name: e.name, companyId: company.id, ...flags,
          allergens: { create: join("allergenId", (e.allergens ?? []).map((a) => allergenId.get(a))) },
          dietaryTags: { create: join("dietaryTagId", (e.tags ?? []).map((t) => tagId.get(t))) } },
      });
      if (i === 0) ownerId = employee.id;
    }
    await prisma.company.update({ where: { id: company.id }, data: { ownerEmployeeId: ownerId } });

    for (const name of def.hiddenCategories ?? []) {
      await prisma.companyHiddenCategory.upsert({ where: { companyId_categoryId: { companyId: company.id, categoryId: categoryId.get(name)! } }, update: {}, create: { companyId: company.id, categoryId: categoryId.get(name)! } });
    }
    for (const sku of def.hiddenDishes ?? []) {
      await prisma.companyHiddenDish.upsert({ where: { companyId_dishId: { companyId: company.id, dishId: dishIds.get(sku)! } }, update: {}, create: { companyId: company.id, dishId: dishIds.get(sku)! } });
    }
  }
}

async function upsertTier(
  prisma: PrismaClient,
  t: { name: string; derivationType: "NONE" | "COST_MULTIPLE" | "TIER_PERCENT"; multiplierMilli?: number; percentBp?: number; baseTierId?: number },
) {
  const rule = { derivationType: t.derivationType, multiplierMilli: t.multiplierMilli ?? null, percentBp: t.percentBp ?? null, baseTierId: t.baseTierId ?? null };
  return prisma.priceTier.upsert({ where: { name: t.name }, update: rule, create: { name: t.name, ...rule } });
}
