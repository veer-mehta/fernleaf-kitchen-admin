import { Injectable } from "@nestjs/common";
import { PriceTier } from "@prisma/client";
import { DomainError } from "../common/domain-error";
import { PrismaService } from "../prisma/prisma.service";
import { DerivationRule, planChanges } from "./tier-derivation";

// Reads a tier's rule out of its database columns (null = prices are all typed in by hand).
function ruleOf(tier: PriceTier): DerivationRule | null {
  if (tier.derivationType === "COST_MULTIPLE" && tier.multiplierMilli !== null) {
    return { type: "COST_MULTIPLE", multiplierMilli: tier.multiplierMilli };
  }
  if (tier.derivationType === "TIER_PERCENT" && tier.percentBp !== null && tier.baseTierId !== null) {
    return { type: "TIER_PERCENT", percentBp: tier.percentBp };
  }
  return null;
}

// Prices are materialised: every price a tier sells at is a row in DishPrice/OptionPrice.
// A derived tier's rows are rewritten here whenever its rule, its base tier or a cost changes.
// Rows with isOverride = true were typed by a person and are never rewritten.
@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  async recomputeTier(tierId: number, depth = 0): Promise<void> {
    if (depth > 20) return; // safety net only; cycles are rejected when a tier is saved
    const tier = await this.prisma.priceTier.findUnique({ where: { id: tierId } });
    if (!tier) return;

    const rule = ruleOf(tier);
    if (rule) {
      await this.recomputeDishes(tier.id, rule, tier.baseTierId);
      await this.recomputeOptions(tier.id, rule, tier.baseTierId);
    }
    await this.recomputeDependents(tierId, depth);
  }

  // Tiers that take their prices from this one must follow when it changes.
  async recomputeDependents(tierId: number, depth = 0): Promise<void> {
    const dependents = await this.prisma.priceTier.findMany({ where: { baseTierId: tierId } });
    for (const dependent of dependents) await this.recomputeTier(dependent.id, depth + 1);
  }

  // Called when a dish or option is created or its cost changes. Tiers based on cost are
  // recomputed, and tiers based on those follow through recomputeDependents.
  async recomputeAll(): Promise<void> {
    const tiers = await this.prisma.priceTier.findMany({ where: { derivationType: "COST_MULTIPLE" } });
    for (const tier of tiers) await this.recomputeTier(tier.id);
  }

  async setDishPrice(tierId: number, dishId: number, cents: number) {
    await this.assertTierExists(tierId);
    if (!(await this.prisma.dish.findUnique({ where: { id: dishId } }))) {
      throw new DomainError("NOT_FOUND", "Dish not found", 404);
    }
    await this.prisma.dishPrice.upsert({
      where: { tierId_dishId: { tierId, dishId } },
      update: { cents, isOverride: true },
      create: { tierId, dishId, cents, isOverride: true },
    });
    await this.recomputeDependents(tierId);
    return { tierId, dishId, cents, isOverride: true };
  }

  async clearDishPrice(tierId: number, dishId: number) {
    await this.assertTierExists(tierId);
    await this.prisma.dishPrice.deleteMany({ where: { tierId, dishId } });
    await this.recomputeTier(tierId); // a derived tier refills the price; a manual tier stays empty
    return { ok: true };
  }

  async setOptionPrice(tierId: number, optionId: number, cents: number) {
    await this.assertTierExists(tierId);
    if (!(await this.prisma.option.findUnique({ where: { id: optionId } }))) {
      throw new DomainError("NOT_FOUND", "Option not found", 404);
    }
    await this.prisma.optionPrice.upsert({
      where: { tierId_optionId: { tierId, optionId } },
      update: { cents, isOverride: true },
      create: { tierId, optionId, cents, isOverride: true },
    });
    await this.recomputeDependents(tierId);
    return { tierId, optionId, cents, isOverride: true };
  }

  async clearOptionPrice(tierId: number, optionId: number) {
    await this.assertTierExists(tierId);
    await this.prisma.optionPrice.deleteMany({ where: { tierId, optionId } });
    await this.recomputeTier(tierId);
    return { ok: true };
  }

  private async assertTierExists(tierId: number) {
    if (!(await this.prisma.priceTier.findUnique({ where: { id: tierId } }))) {
      throw new DomainError("NOT_FOUND", "Price tier not found", 404);
    }
  }

  private async recomputeDishes(tierId: number, rule: DerivationRule, baseTierId: number | null) {
    const [dishes, rows, baseRows] = await Promise.all([
      this.prisma.dish.findMany({ select: { id: true, costCents: true } }),
      this.prisma.dishPrice.findMany({ where: { tierId } }),
      baseTierId ? this.prisma.dishPrice.findMany({ where: { tierId: baseTierId } }) : undefined,
    ]);
    const existing = new Map(rows.map((r) => [r.dishId, { cents: r.cents, isOverride: r.isOverride }]));
    const basePrices = baseRows ? new Map(baseRows.map((r) => [r.dishId, r.cents])) : undefined;
    // allowZero = false: a dish derived to 0 cents would show as free, so it gets no price.
    const plan = planChanges(rule, dishes, existing, basePrices, false);

    await this.prisma.$transaction([
      ...plan.upserts.map((u) =>
        this.prisma.dishPrice.upsert({
          where: { tierId_dishId: { tierId, dishId: u.id } },
          update: { cents: u.cents },
          create: { tierId, dishId: u.id, cents: u.cents },
        }),
      ),
      this.prisma.dishPrice.deleteMany({ where: { tierId, dishId: { in: plan.deletes }, isOverride: false } }),
    ]);
  }

  private async recomputeOptions(tierId: number, rule: DerivationRule, baseTierId: number | null) {
    const [options, rows, baseRows] = await Promise.all([
      this.prisma.option.findMany({ select: { id: true, costCents: true } }),
      this.prisma.optionPrice.findMany({ where: { tierId } }),
      baseTierId ? this.prisma.optionPrice.findMany({ where: { tierId: baseTierId } }) : undefined,
    ]);
    const existing = new Map(rows.map((r) => [r.optionId, { cents: r.cents, isOverride: r.isOverride }]));
    const basePrices = baseRows ? new Map(baseRows.map((r) => [r.optionId, r.cents])) : undefined;
    // allowZero = true: an option that adds nothing to the dish price is legitimate.
    const plan = planChanges(rule, options, existing, basePrices, true);

    await this.prisma.$transaction([
      ...plan.upserts.map((u) =>
        this.prisma.optionPrice.upsert({
          where: { tierId_optionId: { tierId, optionId: u.id } },
          update: { cents: u.cents },
          create: { tierId, optionId: u.id, cents: u.cents },
        }),
      ),
      this.prisma.optionPrice.deleteMany({ where: { tierId, optionId: { in: plan.deletes }, isOverride: false } }),
    ]);
  }
}
