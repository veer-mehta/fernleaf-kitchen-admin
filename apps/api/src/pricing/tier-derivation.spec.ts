import { derivePrice, planChanges } from "./tier-derivation";

describe("derivePrice", () => {
  it("cost x 2.4 rounds up to the next 5 cents (211.2 -> 215)", () =>
    expect(derivePrice({ type: "COST_MULTIPLE", multiplierMilli: 2400 }, { costCents: 88 })).toBe(215));

  it("exact multiples of 5 are not bumped", () =>
    expect(derivePrice({ type: "COST_MULTIPLE", multiplierMilli: 2500 }, { costCents: 100 })).toBe(250));

  it("standard + 15%", () =>
    expect(derivePrice({ type: "TIER_PERCENT", percentBp: 1500 }, { costCents: 0, basePriceCents: 1000 })).toBe(1150));

  it("percent that lands between 5s rounds up (1003 + 15% = 1153.45 -> 1155)", () =>
    expect(derivePrice({ type: "TIER_PERCENT", percentBp: 1500 }, { costCents: 0, basePriceCents: 1003 })).toBe(1155));

  it("a discount works (1000 - 10% = 900)", () =>
    expect(derivePrice({ type: "TIER_PERCENT", percentBp: -1000 }, { costCents: 0, basePriceCents: 1000 })).toBe(900));

  it("returns null when the base tier has no price", () =>
    expect(derivePrice({ type: "TIER_PERCENT", percentBp: 1500 }, { costCents: 0 })).toBeNull());

  it("never produces float cents", () => {
    for (const cost of [1, 7, 33, 99, 101, 12345]) {
      const price = derivePrice({ type: "COST_MULTIPLE", multiplierMilli: 2400 }, { costCents: cost })!;
      expect(Number.isInteger(price)).toBe(true);
      expect(price % 5).toBe(0);
    }
  });
});

describe("planChanges", () => {
  const rule = { type: "COST_MULTIPLE", multiplierMilli: 2000 } as const; // x2
  const items = [
    { id: 1, costCents: 100 },
    { id: 2, costCents: 200 },
    { id: 3, costCents: 300 },
  ];

  it("creates rows that are missing and updates rows whose value changed", () => {
    const existing = new Map([
      [1, { cents: 200, isOverride: false }], // already right
      [2, { cents: 999, isOverride: false }], // stale
    ]);
    const plan = planChanges(rule, items, existing, undefined, false);
    expect(plan.upserts).toEqual([
      { id: 2, cents: 400 },
      { id: 3, cents: 600 },
    ]);
    expect(plan.deletes).toEqual([]);
  });

  it("never touches a manual override", () => {
    const existing = new Map([[1, { cents: 777, isOverride: true }]]);
    const plan = planChanges(rule, items, existing, undefined, false);
    expect(plan.upserts.map((u) => u.id)).toEqual([2, 3]);
  });

  it("deletes a derived row when the base price disappeared", () => {
    const percent = { type: "TIER_PERCENT", percentBp: 1000 } as const;
    const existing = new Map([[1, { cents: 110, isOverride: false }]]);
    const plan = planChanges(percent, items, existing, new Map(), false); // base has no prices
    expect(plan.deletes).toEqual([1]);
    expect(plan.upserts).toEqual([]);
  });

  it("a zero price is no price when zero is not allowed (dishes) but fine when allowed (options)", () => {
    const free = [{ id: 1, costCents: 0 }];
    expect(planChanges(rule, free, new Map(), undefined, false).upserts).toEqual([]);
    expect(planChanges(rule, free, new Map(), undefined, true).upserts).toEqual([{ id: 1, cents: 0 }]);
  });
});
