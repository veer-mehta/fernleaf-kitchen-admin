import { ceilTo5, ceilDivTo5, formatCents } from "./money";

describe("ceilTo5", () => {
  it.each([
    [211, 215],
    [215, 215],
    [216, 220],
    [0, 0],
    [1, 5],
  ])("%i -> %i", (input, expected) => {
    expect(ceilTo5(input)).toBe(expected);
  });
});

describe("ceilDivTo5", () => {
  it("cost 100c x 2.4 = 240 stays 240", () => expect(ceilDivTo5(100 * 2400, 1000)).toBe(240));
  it("cost 101c x 2.4 = 242.4 rounds up to 245", () =>
    expect(ceilDivTo5(101 * 2400, 1000)).toBe(245));
  it("1c x 1.15 rounds up to 5", () => expect(ceilDivTo5(1 * 11500, 10000)).toBe(5));
});

describe("formatCents", () => {
  it("formats rupees with two decimals", () => expect(formatCents(123450)).toBe("₹1,234.50"));
  it("formats zero", () => expect(formatCents(0)).toBe("₹0.00"));
});
