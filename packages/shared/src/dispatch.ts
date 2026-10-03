import { z } from "zod";
import { imageRef } from "./images";
import { isoDate } from "./settings";

export const DispatchBoardQuery = z.object({ date: isoDate.optional() });

export const AssignDriverInput = z.object({ driverId: z.number().int().positive().nullable() }).strict();

// The note and photo a driver can attach when marking a drop delivered.
export const DeliveredInput = z
  .object({
    note: z.string().trim().max(500).optional(),
    photoUrl: imageRef.optional(),
  })
  .strict();
