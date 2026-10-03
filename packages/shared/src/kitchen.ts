import { z } from "zod";
import { isoDate } from "./settings";

// date defaults to today in the kitchen zone. stationId is a station's id, or "none" for Unassigned.
export const KitchenBoardQuery = z.object({
  date: isoDate.optional(),
  stationId: z.string().regex(/^(\d+|none)$/, "Use a station id or none").optional(),
});
