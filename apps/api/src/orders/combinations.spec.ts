import { DomainError } from "../common/domain-error";
import { CombinationInput, GroupRule, combinationKey, countPrepUnits, validateLine } from "./combinations";

const rice: GroupRule = { groupId: 1, name: "Rice", required: true, optionIds: [10, 11] };
const side: GroupRule = { groupId: 2, name: "Side", required: false, optionIds: [20] };
const groups = [rice, side];

const brown: CombinationInput = { quantity: 6, selections: [{ groupId: 1, optionId: 10 }] };
const jeera: CombinationInput = { quantity: 4, selections: [{ groupId: 1, optionId: 11 }] };

// Runs validateLine and returns the field errors it reported (or null when it passed).
function errorsOf(fn: () => void): Record<string, string> | null {
  try {
    fn();
    return null;
  } catch (e) {
    if (e instanceof DomainError) return e.fields ?? {};
    throw e;
  }
}

describe("validateLine", () => {
  it("accepts the assignment example: 10 bowls = 6 brown rice + 4 jeera rice", () => {
    expect(errorsOf(() => validateLine(10, null, [brown, jeera], groups))).toBeNull();
  });

  it("combination quantities must add up exactly to the dish quantity", () => {
    const tooFew = errorsOf(() => validateLine(10, null, [brown, { ...jeera, quantity: 3 }], groups));
    expect(tooFew?.combinations).toMatch(/add up/i);
    const tooMany = errorsOf(() => validateLine(10, null, [brown, { ...jeera, quantity: 5 }], groups));
    expect(tooMany?.combinations).toMatch(/add up/i);
  });

  it("every required group needs a choice", () => {
    const missing = errorsOf(() => validateLine(5, null, [{ quantity: 5, selections: [] }], groups));
    expect(missing?.["combinations.0.selections"]).toMatch(/Rice/);
  });

  it("an optional group may be left out, or chosen", () => {
    const withSide: CombinationInput = { quantity: 5, selections: [{ groupId: 1, optionId: 10 }, { groupId: 2, optionId: 20 }] };
    expect(errorsOf(() => validateLine(5, null, [withSide], groups))).toBeNull();
    expect(errorsOf(() => validateLine(5, null, [{ quantity: 5, selections: [{ groupId: 1, optionId: 10 }] }], groups))).toBeNull();
  });

  it("RF3: an option that belongs to a different group is rejected", () => {
    const wrong: CombinationInput = { quantity: 5, selections: [{ groupId: 1, optionId: 20 }] };
    expect(errorsOf(() => validateLine(5, null, [wrong], groups))?.["combinations.0.selections"]).toMatch(/not offered/i);
  });

  it("RF3: an option that does not exist at all is rejected", () => {
    const wrong: CombinationInput = { quantity: 5, selections: [{ groupId: 1, optionId: 999 }] };
    expect(errorsOf(() => validateLine(5, null, [wrong], groups))).not.toBeNull();
  });

  it("a group the dish does not have is rejected", () => {
    const wrong: CombinationInput = { quantity: 5, selections: [{ groupId: 1, optionId: 10 }, { groupId: 99, optionId: 10 }] };
    expect(errorsOf(() => validateLine(5, null, [wrong], groups))?.["combinations.0.selections"]).toMatch(/unknown/i);
  });

  it("only one option per group", () => {
    const two: CombinationInput = { quantity: 5, selections: [{ groupId: 1, optionId: 10 }, { groupId: 1, optionId: 11 }] };
    expect(errorsOf(() => validateLine(5, null, [two], groups))?.["combinations.0.selections"]).toMatch(/only one/i);
  });

  it.each([0, -3, 2.5, NaN])("RF3: line quantity %p is rejected", (qty) => {
    expect(errorsOf(() => validateLine(qty, null, [{ quantity: 1, selections: [{ groupId: 1, optionId: 10 }] }], groups))?.quantity).toBeDefined();
  });

  it.each([0, -1, 1.5])("RF3: combination quantity %p is rejected", (qty) => {
    const bad: CombinationInput = { quantity: qty, selections: [{ groupId: 1, optionId: 10 }] };
    expect(errorsOf(() => validateLine(6, null, [bad, { ...jeera, quantity: 6 }], groups))?.["combinations.0.quantity"]).toBeDefined();
  });

  it("RF3: two combinations with the same choices must be merged, whatever order the choices come in", () => {
    const a: CombinationInput = { quantity: 3, selections: [{ groupId: 1, optionId: 10 }, { groupId: 2, optionId: 20 }] };
    const b: CombinationInput = { quantity: 2, selections: [{ groupId: 2, optionId: 20 }, { groupId: 1, optionId: 10 }] };
    expect(errorsOf(() => validateLine(5, null, [a, b], groups))?.["combinations.1.selections"]).toMatch(/same choices/i);
  });

  it("a dish with no groups is one combination with no selections; two of them must be merged", () => {
    expect(errorsOf(() => validateLine(10, null, [{ quantity: 10, selections: [] }], []))).toBeNull();
    const split = errorsOf(() => validateLine(10, null, [{ quantity: 6, selections: [] }, { quantity: 4, selections: [] }], []));
    expect(split?.["combinations.1.selections"]).toMatch(/same choices/i);
  });

  it("needs at least one combination", () => {
    expect(errorsOf(() => validateLine(5, null, [], groups))?.combinations).toBeDefined();
  });

  it("enforces the dish's minimum order quantity", () => {
    expect(errorsOf(() => validateLine(4, 5, [{ quantity: 4, selections: [{ groupId: 1, optionId: 10 }] }], groups))?.quantity).toMatch(/minimum.*5/i);
    expect(errorsOf(() => validateLine(5, 5, [{ quantity: 5, selections: [{ groupId: 1, optionId: 10 }] }], groups))).toBeNull();
  });

  it("reports several problems at once instead of one at a time", () => {
    const errors = errorsOf(() => validateLine(10, null, [{ quantity: 3, selections: [] }, { quantity: 3, selections: [{ groupId: 1, optionId: 999 }] }], groups));
    expect(Object.keys(errors ?? {}).length).toBeGreaterThanOrEqual(3);
  });

  it("prefixes every field so errors point at the right line in an order", () => {
    const errors = errorsOf(() => validateLine(10, null, [brown], groups, "lines.2."));
    expect(errors?.["lines.2.combinations"]).toBeDefined();
  });

  it("throws a 400 INVALID_COMBINATIONS DomainError", () => {
    try {
      validateLine(10, null, [brown], groups);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("INVALID_COMBINATIONS");
      expect((e as DomainError).status).toBe(400);
    }
  });
});

describe("combinationKey", () => {
  it("is the same for the same choices in any order", () => {
    const a = combinationKey({ quantity: 1, selections: [{ groupId: 1, optionId: 10 }, { groupId: 2, optionId: 20 }] });
    const b = combinationKey({ quantity: 9, selections: [{ groupId: 2, optionId: 20 }, { groupId: 1, optionId: 10 }] });
    expect(a).toBe(b);
  });

  it("differs when an option or a portion size differs", () => {
    const base = combinationKey({ quantity: 1, selections: [{ groupId: 1, optionId: 10 }] });
    expect(combinationKey({ quantity: 1, selections: [{ groupId: 1, optionId: 11 }] })).not.toBe(base);
    expect(combinationKey({ quantity: 1, selections: [{ groupId: 1, optionId: 10, portionSizeId: 3 }] })).not.toBe(base);
  });
});

describe("countPrepUnits (combination counting)", () => {
  it("the kitchen cooks each distinct combination as one unit", () => {
    expect(countPrepUnits([{ combinations: [brown, jeera] }])).toBe(2);
  });

  it("units are counted per order line, even when two lines have identical choices", () => {
    expect(countPrepUnits([{ combinations: [brown] }, { combinations: [brown, jeera] }])).toBe(3);
  });

  it("is zero for no lines", () => {
    expect(countPrepUnits([])).toBe(0);
  });
});
