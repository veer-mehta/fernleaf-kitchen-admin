import { DateTime } from "luxon";
import { z } from "zod";

// Platform-wide kitchen settings. Staff edit these in the UI; defaults apply until they do.
export interface KitchenSettings {
  timezone: string; // IANA zone the whole kitchen runs in
  workingDays: number[]; // ISO weekdays, 1 = Monday ... 7 = Sunday
  cutoffTime: string; // "HH:mm" in the kitchen zone
  cutoffWorkingDays: number; // kitchen working days before delivery that orders lock
  kitchenReadyBufferMinutes: number; // kitchen-ready is this long before dispatch-ready
  onTimeGraceMinutes: number; // a delivery this late still counts as on time
  holidays: string[]; // kitchen holidays as "YYYY-MM-DD"
}

export const DEFAULT_SETTINGS: Omit<KitchenSettings, "holidays"> = {
  timezone: "Asia/Kolkata",
  workingDays: [1, 2, 3, 4, 5],
  cutoffTime: "16:00",
  cutoffWorkingDays: 2,
  kitchenReadyBufferMinutes: 30,
  onTimeGraceMinutes: 0,
};

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD")
  .refine((s) => DateTime.fromISO(s).isValid, "That is not a real date");

export const SettingsInput = z.object({
  timezone: z.string().refine((tz) => DateTime.local().setZone(tz).isValid, "Unknown time zone").optional(),
  workingDays: z
    .array(z.number().int().min(1).max(7))
    .min(1, "Pick at least one working day")
    .refine((d) => new Set(d).size === d.length, "Each day can only be listed once")
    .optional(),
  cutoffTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use the 24-hour format HH:mm").optional(),
  cutoffWorkingDays: z.number().int().min(0).max(14).optional(),
  kitchenReadyBufferMinutes: z.number().int().min(0).max(240).optional(),
  onTimeGraceMinutes: z.number().int().min(0).max(240).optional(),
});

export const HolidayInput = z.object({
  date: isoDate,
  name: z.string().trim().max(80).default(""),
});
export { isoDate };
