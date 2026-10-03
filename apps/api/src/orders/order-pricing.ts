// Money maths for orders. Everything is a whole number of cents; these functions refuse
// anything else so a float can never slip into a total.

const assertCents = (n: number, what: string) => {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${what} must be a whole number of cents, got ${n}`);
};

// Price of ONE unit of a combination: the dish price plus every chosen option,
// plus the portion surcharge when the option is sold in sizes.
export function priceCombination(
  dishCents: number,
  picks: { optionCents: number; portionExtraCents: number }[],
): number {
  assertCents(dishCents, "Dish price");
  let unit = dishCents;
  for (const pick of picks) {
    assertCents(pick.optionCents, "Option price");
    assertCents(pick.portionExtraCents, "Portion extra");
    unit += pick.optionCents + pick.portionExtraCents;
  }
  return unit;
}

// Price of a whole combination: (dish + options) x its quantity.
export function lineTotal(unitCents: number, quantity: number): number {
  assertCents(unitCents, "Unit price");
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error(`Quantity must be a whole number, got ${quantity}`);
  return unitCents * quantity;
}

// The order total is just the sum of its lines (no tax, no fees).
export function orderTotal(lineTotals: number[]): number {
  return lineTotals.reduce((sum, t) => {
    assertCents(t, "Line total");
    return sum + t;
  }, 0);
}
