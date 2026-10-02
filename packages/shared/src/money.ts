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
