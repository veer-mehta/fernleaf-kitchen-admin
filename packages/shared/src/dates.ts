import { DateTime } from "luxon";

// "Today" in the kitchen's time zone as YYYY-MM-DD. The server's own zone never matters.
export function kitchenToday(now: Date, tz: string): string {
  return DateTime.fromJSDate(now, { zone: tz }).toISODate()!;
}
