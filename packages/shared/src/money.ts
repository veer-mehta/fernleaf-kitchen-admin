// All money in this project is an integer number of cents (paise). Never a float.

export const ceilTo5 = (cents: number): number => Math.ceil(cents / 5) * 5;

// Round n/d UP to the next multiple of 5 in one step. Rounding the quotient first
// and then rounding to 5 could round twice; here only the final ceiling is taken.
// n and d are small integers, so the division cannot introduce a visible float error.
export const ceilDivTo5 = (n: number, d: number): number => Math.ceil(n / (d * 5)) * 5;

// Display only. Uses integer maths for the split so no float ever touches the cents.
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const rupees = Math.trunc(abs / 100);
  const paise = String(abs % 100).padStart(2, "0");
  return `${sign}₹${rupees.toLocaleString("en-IN")}.${paise}`;
}

// Turns text typed by a person ("12.50", "2.4", "-10") into an integer scaled by 10^scale
// (1250, 2400, -1000) using only string handling, so no float ever appears.
// Returns null when the text is not a plain decimal with at most `scale` decimal places.
export function parseDecimalToInt(text: string, scale: number): number | null {
  const match = /^(-?)(\d*)(?:\.(\d+))?$/.exec(text.trim());
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  if (whole === "" && fraction === "") return null;
  if (fraction.length > scale) return null;
  const value = Number(whole || "0") * 10 ** scale + Number(fraction.padEnd(scale, "0") || "0");
  return sign === "-" ? -value : value;
}

// The reverse of parseDecimalToInt, for showing stored integers in inputs.
// keepZeros = true gives "12.50" (money); false gives "2.4" (rates).
export function formatScaled(value: number, scale: number, keepZeros = false): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const whole = Math.trunc(abs / 10 ** scale);
  let fraction = String(abs % 10 ** scale).padStart(scale, "0");
  if (!keepZeros) fraction = fraction.replace(/0+$/, "");
  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}
