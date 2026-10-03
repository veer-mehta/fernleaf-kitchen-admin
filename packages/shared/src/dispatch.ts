import { z } from "zod";
import { isoDate } from "./settings";

export const DispatchBoardQuery = z.object({ date: isoDate.optional() });

export const AssignDriverInput = z.object({ driverId: z.number().int().positive().nullable() }).strict();

// The note and photo a driver can attach when marking a drop delivered. Only web links are accepted
// (a "javascript:" address would be dangerous if it were ever shown as a link).
const webUrl = z
  .string()
  .trim()
  .max(500)
  .refine((u) => /^https?:\/\/\S+$/i.test(u), "Use a link starting with http:// or https://");

export const DeliveredInput = z
  .object({
    note: z.string().trim().max(500).optional(),
    photoUrl: webUrl.optional(),
  })
  .strict();
