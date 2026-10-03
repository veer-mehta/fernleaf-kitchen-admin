import { PrismaClient } from "@prisma/client";
import { DEFAULT_SETTINGS, KitchenSettings } from "@fernleaf/shared";
import { toDateString } from "../common/dates";

// Reads the kitchen settings with a plain database client. SettingsService uses it, and so does the
// seed script (which runs outside NestJS). Saved values override the defaults in code.
export async function loadKitchenSettings(prisma: PrismaClient): Promise<KitchenSettings> {
  const [rows, holidays] = await Promise.all([
    prisma.setting.findMany(),
    prisma.kitchenHoliday.findMany({ orderBy: { date: "asc" } }),
  ]);
  const saved = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { ...DEFAULT_SETTINGS, ...saved, holidays: holidays.map((h) => toDateString(h.date)) };
}
