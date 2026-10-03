import { ceilTo5, ceilDivTo5, formatCents, parseDecimalToInt, formatScaled } from "./money";

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

describe("parseDecimalToInt", () => {
  it.each([
    ["12.50", 2, 1250],
    ["12.5", 2, 1250],
    ["12", 2, 1200],
    ["0.05", 2, 5],
    [".5", 2, 50],
    [" 7.25 ", 2, 725],
    ["2.4", 3, 2400],
    ["15", 2, 1500],
    ["-10", 2, -1000],
  ])("%s at scale %i -> %i", (text, scale, expected) => {
    expect(parseDecimalToInt(text, scale)).toBe(expected);
  });

  it.each(["", "abc", "1.234", "1,5", "1.2.3", "--1", "12e3"])("rejects %j", (text) => {
    expect(parseDecimalToInt(text, 2)).toBeNull();
  });

  it("never goes through floating point (0.07 -> 7, not 7.000000000000001)", () => {
    expect(parseDecimalToInt("0.07", 2)).toBe(7);
    expect(parseDecimalToInt("1.15", 2)).toBe(115);
  });
});

describe("formatScaled", () => {
  it("keeps trailing zeros when asked (money: 12.50)", () => {
    expect(formatScaled(1250, 2, true)).toBe("12.50");
    expect(formatScaled(5, 2, true)).toBe("0.05");
    expect(formatScaled(-1000, 2, true)).toBe("-10.00");
  });

  it("drops trailing zeros by default (rates: 2.4, 15)", () => {
    expect(formatScaled(2400, 3)).toBe("2.4");
    expect(formatScaled(2000, 3)).toBe("2");
    expect(formatScaled(1500, 2)).toBe("15");
    expect(formatScaled(-1000, 2)).toBe("-10");
  });

  it("round-trips with parseDecimalToInt", () => {
    for (const v of [0, 5, 99, 1250, 123456]) {
      expect(parseDecimalToInt(formatScaled(v, 2, true), 2)).toBe(v);
    }
  });
});
