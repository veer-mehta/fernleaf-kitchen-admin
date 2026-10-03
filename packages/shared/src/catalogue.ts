import { z } from "zod";
import { PageQuery } from "./pagination";

const id = z.number().int().positive();
const cents = z.number({ invalid_type_error: "Enter an amount in cents" }).int("Must be a whole number of cents").min(0, "Cannot be negative");

export const DishInput = z.object({
  sku: z.string().trim().min(1, "SKU is required").max(40),
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(1000).default(""),
  imageUrl: z.string().trim().url("Enter a valid URL").nullable().optional(),
  temperature: z.enum(["HOT", "COLD"]),
  costCents: cents,
  stationId: id.nullable().optional(),
  minOrderQty: z.number().int().min(1, "Must be at least 1").nullable().optional(),
  allergenIds: z.array(id).default([]),
  dietaryTagIds: z.array(id).default([]),
});
// For PATCH every field is optional. (.partial() would keep the defaults above, which would
// silently reset description and the id lists, so defaults are stripped first.)
export const UpdateDishInput = DishInput.extend({
  description: z.string().trim().max(1000),
  allergenIds: z.array(id),
  dietaryTagIds: z.array(id),
}).partial();

export const DishListQuery = PageQuery.extend({
  search: z.string().trim().optional(),
  active: z.enum(["true", "false"]).optional(),
  stationId: z.coerce.number().int().positive().optional(),
});

export const OptionInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  costCents: cents,
  allergenIds: z.array(id).default([]),
  dietaryTagIds: z.array(id).default([]),
});
export const UpdateOptionInput = OptionInput.extend({
  allergenIds: z.array(id),
  dietaryTagIds: z.array(id),
})
  .partial()
  .extend({ active: z.boolean().optional() });

export const OptionListQuery = PageQuery.extend({
  search: z.string().trim().optional(),
  active: z.enum(["true", "false"]).optional(),
});

// The whole set of option groups for one dish; array position is the display order.
export const GroupsInput = z.object({
  groups: z.array(
    z.object({
      name: z.string().trim().min(1, "Group name is required").max(120),
      required: z.boolean(),
      usesPortions: z.boolean().default(false),
      optionIds: z
        .array(id)
        .min(1, "A group needs at least one option")
        .refine((ids) => new Set(ids).size === ids.length, "An option can only be listed once"),
      portions: z.array(z.object({ portionSizeId: id, extraCents: cents })).default([]),
    }),
  ),
});

