import { z } from "zod";

const id = z.number().int().positive();

// How a tier gets its prices when they are not typed in by hand.
const Derivation = z.discriminatedUnion("type", [
  z.object({ type: z.literal("NONE") }),
  // 2.4x is sent as 2400 so no decimals are involved
  z.object({ type: z.literal("COST_MULTIPLE"), multiplierMilli: z.number().int().min(1, "Must be above 0") }),
  // +15% is sent as 1500 basis points; negative values are discounts
  z.object({
    type: z.literal("TIER_PERCENT"),
    percentBp: z.number().int().min(-9999, "A discount cannot be 100% or more"),
    baseTierId: id,
  }),
]);

export const TierInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  isDefault: z.boolean().optional(),
  derivation: Derivation.default({ type: "NONE" }),
});

export const UpdateTierInput = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  isDefault: z.boolean().optional(),
  derivation: Derivation.optional(),
});

// A dish priced at 0 would appear on the menu as free, so dish prices start at 1 cent.
export const DishPriceInput = z.object({
  cents: z.number().int("Must be a whole number of cents").min(1, "A dish price must be at least 1 cent"),
});
export const OptionPriceInput = z.object({
  cents: z.number().int("Must be a whole number of cents").min(0, "Cannot be negative"),
});
