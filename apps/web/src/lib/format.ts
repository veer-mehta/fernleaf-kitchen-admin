// Display helpers. Times are shown in the kitchen's time zone (Asia/Kolkata), not the browser's,
// so everybody sees the same clock as the kitchen.
const KITCHEN_TZ = "Asia/Kolkata";

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: KITCHEN_TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

export const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { timeZone: KITCHEN_TZ, hour: "2-digit", minute: "2-digit", hour12: false });

// "2026-10-07" -> "Wed 7 Oct 2026". Parsed as UTC so the browser's zone cannot shift the day.
export const formatDate = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });

export const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]; // ISO day 1..7
