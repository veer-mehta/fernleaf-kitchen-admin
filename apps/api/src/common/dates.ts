// Delivery dates are plain calendar dates ("2026-10-07"), stored in Postgres as DATE.
// Prisma hands a DATE back as a JS Date at 00:00 UTC, so these two helpers convert safely
// without the server's time zone ever being involved.
export const toDateString = (d: Date): string => d.toISOString().slice(0, 10);
export const fromDateString = (s: string): Date => new Date(`${s}T00:00:00.000Z`);
