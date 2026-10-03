import { z } from "zod";
import { isoDate } from "./settings";

// Dashboards default to today in the kitchen zone; a date can be chosen to look at another day.
export const DashboardQuery = z.object({ date: isoDate.optional() });
