import { Injectable } from "@nestjs/common";
import { DerivationType, PriceTier } from "@prisma/client";
import { DomainError } from "../common/domain-error";
import { isUniqueViolation } from "../common/prisma-errors";
import { PrismaService } from "../prisma/prisma.service";
import { PricingService } from "./pricing.service";

export type DerivationInput =
  | { type: "NONE" }
  | { type: "COST_MULTIPLE"; multiplierMilli: number }
  | { type: "TIER_PERCENT"; percentBp: number; baseTierId: number };

// The tier as the API returns it: the rule is grouped into one `derivation` object.
function toTier(t: PriceTier) {
  const derivation =
    t.derivationType === "COST_MULTIPLE"
      ? { type: "COST_MULTIPLE", multiplierMilli: t.multiplierMilli }
      : t.derivationType === "TIER_PERCENT"
        ? { type: "TIER_PERCENT", percentBp: t.percentBp, baseTierId: t.baseTierId }
        : { type: "NONE" };
  return { id: t.id, name: t.name, isDefault: t.isDefault, derivation };
}

// The database columns for a rule. Unused columns are cleared so old values cannot linger.
function toColumns(d: DerivationInput) {
  return {
    derivationType: d.type as DerivationType,
    multiplierMilli: d.type === "COST_MULTIPLE" ? d.multiplierMilli : null,
    percentBp: d.type === "TIER_PERCENT" ? d.percentBp : null,
    baseTierId: d.type === "TIER_PERCENT" ? d.baseTierId : null,
  };
}

@Injectable()
export class TiersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  async list() {
    const tiers = await this.prisma.priceTier.findMany({ orderBy: { id: "asc" } });
    return tiers.map(toTier);
  }

  async create(input: { name: string; isDefault?: boolean; derivation: DerivationInput }) {
    await this.assertRuleIsValid(null, input.derivation);
    try {
      const tier = await this.prisma.$transaction(async (tx) => {
        // The very first tier is always the default; otherwise only if asked.
        const makeDefault = input.isDefault === true || (await tx.priceTier.count()) === 0;
        if (makeDefault) await tx.priceTier.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
        return tx.priceTier.create({
          data: { name: input.name, isDefault: makeDefault, ...toColumns(input.derivation) },
        });
      });
      await this.pricing.recomputeTier(tier.id);
      return toTier(tier);
    } catch (e) {
      throw this.translate(e);
    }
  }

  async update(id: number, input: { name?: string; isDefault?: boolean; derivation?: DerivationInput }) {
    const current = await this.prisma.priceTier.findUnique({ where: { id } });
    if (!current) throw new DomainError("NOT_FOUND", "Price tier not found", 404);

    if (input.isDefault === false && current.isDefault) {
      throw new DomainError("DEFAULT_REQUIRED", "There must always be a default tier. Make another tier the default instead.", 400);
    }
    if (input.derivation) await this.assertRuleIsValid(id, input.derivation);

    try {
      const tier = await this.prisma.$transaction(async (tx) => {
        if (input.isDefault === true && !current.isDefault) {
          await tx.priceTier.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
        }
        return tx.priceTier.update({
          where: { id },
          data: {
            name: input.name,
            isDefault: input.isDefault,
            ...(input.derivation ? toColumns(input.derivation) : {}),
          },
        });
      });
      if (input.derivation) await this.pricing.recomputeTier(id);
      return toTier(tier);
    } catch (e) {
      throw this.translate(e);
    }
  }

  // Every dish and option with its price on this tier (or null) for the grid editor.
  async grid(tierId: number) {
    const tier = await this.prisma.priceTier.findUnique({ where: { id: tierId } });
    if (!tier) throw new DomainError("NOT_FOUND", "Price tier not found", 404);

    const [dishes, options] = await Promise.all([
      this.prisma.dish.findMany({ orderBy: { name: "asc" }, include: { prices: { where: { tierId } } } }),
      this.prisma.option.findMany({ orderBy: { name: "asc" }, include: { prices: { where: { tierId } } } }),
    ]);
    return {
      tier: toTier(tier),
      dishes: dishes.map((d) => ({
        dishId: d.id,
        sku: d.sku,
        name: d.name,
        active: d.active,
        costCents: d.costCents,
        priceCents: d.prices[0]?.cents ?? null,
        isOverride: d.prices[0]?.isOverride ?? false,
      })),
      options: options.map((o) => ({
        optionId: o.id,
        name: o.name,
        active: o.active,
        costCents: o.costCents,
        priceCents: o.prices[0]?.cents ?? null,
        isOverride: o.prices[0]?.isOverride ?? false,
      })),
    };
  }

  // Active dishes and options that this tier does not sell (no price row).
  async missing(tierId: number) {
    if (!(await this.prisma.priceTier.findUnique({ where: { id: tierId } }))) {
      throw new DomainError("NOT_FOUND", "Price tier not found", 404);
    }
    const [dishes, options] = await Promise.all([
      this.prisma.dish.findMany({ where: { active: true, prices: { none: { tierId } } }, orderBy: { name: "asc" } }),
      this.prisma.option.findMany({ where: { active: true, prices: { none: { tierId } } }, orderBy: { name: "asc" } }),
    ]);
    return {
      dishes: dishes.map((d) => ({ dishId: d.id, sku: d.sku, name: d.name })),
      options: options.map((o) => ({ optionId: o.id, name: o.name })),
    };
  }

  // A TIER_PERCENT rule needs an existing base tier, and following the chain of base tiers
  // must never lead back to the tier being saved (A based on B based on A can never settle).
  private async assertRuleIsValid(tierId: number | null, derivation: DerivationInput) {
    if (derivation.type !== "TIER_PERCENT") return;

    if (derivation.baseTierId === tierId) throw this.cycle();
    let cursor: number | null = derivation.baseTierId;
    for (let steps = 0; cursor !== null && steps < 50; steps++) {
      const base: { baseTierId: number | null } | null = await this.prisma.priceTier.findUnique({
        where: { id: cursor },
        select: { baseTierId: true },
      });
      if (!base) {
        throw new DomainError("INVALID_REFERENCE", "The base tier does not exist", 400, {
          "derivation.baseTierId": "That tier does not exist",
        });
      }
      if (base.baseTierId !== null && base.baseTierId === tierId) throw this.cycle();
      cursor = base.baseTierId;
    }
  }

  private cycle() {
    return new DomainError("TIER_CYCLE", "A tier cannot be based on itself, directly or through other tiers", 400, {
      "derivation.baseTierId": "This would make the tiers depend on each other in a loop",
    });
  }

  private translate(e: unknown): unknown {
    if (isUniqueViolation(e)) {
      return new DomainError("NAME_TAKEN", "A tier with that name already exists", 409, {
        name: "A tier with that name already exists",
      });
    }
    return e;
  }
}
