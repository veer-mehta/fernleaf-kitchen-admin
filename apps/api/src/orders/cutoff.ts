import { DateTime } from "luxon";
import { KitchenSettings } from "@fernleaf/shared";
import { DomainError } from "../common/domain-error";

// The moment orders for a delivery date lock.
//
// Count back `cutoffWorkingDays` KITCHEN working days from the delivery date (the delivery date
// itself is never counted), skipping non-working weekdays and kitchen holidays, then take the
// cut-off time on the day you land on. Example (2 days, 16:00): Wednesday delivery -> Monday 16:00.
// The company's own calendar is deliberately not an input: only the kitchen's calendar matters.
export function computeCutoff(deliveryDate: string, s: KitchenSettings): Date {
  if (s.cutoffWorkingDays > 0 && s.workingDays.length === 0) {
    throw new DomainError("NO_WORKING_DAYS", "The kitchen has no working days, so a cut-off cannot be worked out", 500);
  }

  const holidays = new Set(s.holidays);
  // Every date is built IN the kitchen zone, so the server's own zone never matters.
  let day = DateTime.fromISO(deliveryDate, { zone: s.timezone });
  let counted = 0;
  for (let steps = 0; counted < s.cutoffWorkingDays; steps++) {
    if (steps > 400) throw new DomainError("NO_WORKING_DAYS", "No working day found within a year", 500);
    day = day.minus({ days: 1 });
    const isWorking = s.workingDays.includes(day.weekday) && !holidays.has(day.toISODate()!);
    if (isWorking) counted += 1;
  }

  const [hour, minute] = s.cutoffTime.split(":").map(Number);
  return day.set({ hour, minute, second: 0, millisecond: 0 }).toJSDate();
}
