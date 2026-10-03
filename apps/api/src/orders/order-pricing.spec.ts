import { lineTotal, orderTotal, priceCombination } from "./order-pricing";

describe("order pricing", () => {
  it("unit price = dish price + each chosen option price", () => {
    expect(priceCombination(1000, [{ optionCents: 150, portionExtraCents: 0 }, { optionCents: 50, portionExtraCents: 0 }])).toBe(1200);
  });

  it("a portion adds its extra charge on top of the option's own price", () => {
    expect(priceCombination(1000, [{ optionCents: 150, portionExtraCents: 0 }, { optionCents: 50, portionExtraCents: 25 }])).toBe(1225);
  });

  it("a dish with no choices costs the dish price", () => {
    expect(priceCombination(1000, [])).toBe(1000);
  });

  it("a combination's price is (dish + options) x quantity", () => {
    expect(lineTotal(1225, 6)).toBe(7350);
  });

  it("an order total is the plain sum of its line totals (10 bowls: 6 at 12.25 + 4 at 10.00)", () => {
    expect(orderTotal([lineTotal(1225, 6), lineTotal(1000, 4)])).toBe(11350);
  });

  it("an empty order totals zero", () => {
    expect(orderTotal([])).toBe(0);
  });

  it("totals reconcile exactly with no drift on awkward amounts", () => {
    // 0.1 + 0.2 style traps: in cents these are plain integer sums.
    expect(orderTotal([lineTotal(10, 3), lineTotal(20, 3)])).toBe(90);
    expect(orderTotal(Array.from({ length: 1000 }, () => lineTotal(7, 3)))).toBe(21000);
  });

  it.each([[10.5, 2], [10, 2.5], [-10, 2]])("refuses non-integer or negative money (unit %p x qty %p)", (unit, qty) => {
    expect(() => lineTotal(unit, qty)).toThrow();
  });

  it("refuses a fractional option price", () => {
    expect(() => priceCombination(1000, [{ optionCents: 10.5, portionExtraCents: 0 }])).toThrow();
  });
});
