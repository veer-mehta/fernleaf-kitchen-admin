import { z } from "zod";

// Allergens, dietary tags, kitchen stations and portion sizes are all just named lists.
export const REFERENCE_KINDS = ["allergens", "dietary-tags", "stations", "portion-sizes"] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

export const ReferenceInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(60, "Use at most 60 characters"),
});
