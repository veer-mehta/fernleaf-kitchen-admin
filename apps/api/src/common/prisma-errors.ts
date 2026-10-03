import { Prisma } from "@prisma/client";

// Prisma reports database rule violations as errors with a short code.
// These helpers give the three we care about readable names.
const hasCode = (e: unknown, code: string) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === code;

export const isUniqueViolation = (e: unknown) => hasCode(e, "P2002"); // duplicate of a unique value
export const isForeignKeyViolation = (e: unknown) => hasCode(e, "P2003"); // still referenced elsewhere
export const isRecordNotFound = (e: unknown) => hasCode(e, "P2025"); // update/delete of a missing row

// Which column(s) a unique violation was about, e.g. ["name"] or ["domain"].
export const uniqueTarget = (e: unknown): string[] =>
  e instanceof Prisma.PrismaClientKnownRequestError && Array.isArray(e.meta?.target)
    ? (e.meta.target as string[])
    : [];
