import { ceilDivTo5 } from "@fernleaf/shared";

// How a derived tier works out a price. All numbers are integers:
// multiplierMilli 2400 = 2.4x, percentBp 1500 = +15%.
export type DerivationRule =
  | { type: "COST_MULTIPLE"; multiplierMilli: number }
  | { type: "TIER_PERCENT"; percentBp: number };

// Returns the derived price in cents rounded UP to the next 5, or null when it cannot be
// worked out (the base tier has no price for this item, so this tier should not sell it either).
export function derivePrice(
  rule: DerivationRule,
  input: { costCents: number; basePriceCents?: number },
): number | null {
  if (rule.type === "COST_MULTIPLE") {
    return ceilDivTo5(input.costCents * rule.multiplierMilli, 1000);
  }
  if (input.basePriceCents === undefined) return null;
  return ceilDivTo5(input.basePriceCents * (10000 + rule.percentBp), 10000);
}

export interface PricePlan {
  upserts: { id: number; cents: number }[];
  deletes: number[];
}

// Pure planning step: given a tier's rule, the items (dishes or options) and the rows the tier
// already has, decide which rows to write and which to remove. Manual overrides are skipped.
// Keeping this free of database calls makes the rules easy to test.
export function planChanges(
  rule: DerivationRule,
  items: { id: number; costCents: number }[],
  existing: Map<number, { cents: number; isOverride: boolean }>,
  basePrices: Map<number, number> | undefined,
  allowZero: boolean,
): PricePlan {
  const plan: PricePlan = { upserts: [], deletes: [] };
  for (const item of items) {
    const current = existing.get(item.id);
    if (current?.isOverride) continue; // a human typed this price, leave it alone

    const price = derivePrice(rule, { costCents: item.costCents, basePriceCents: basePrices?.get(item.id) });
    const sellable = price !== null && (allowZero || price > 0);

    if (!sellable) {
      if (current) plan.deletes.push(item.id);
    } else if (!current || current.cents !== price) {
      plan.upserts.push({ id: item.id, cents: price });
    }
  }
  return plan;
}
