import { z } from "zod";

const id = z.number().int().positive();

export const CategoryInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  isSecret: z.boolean().default(false),
  active: z.boolean().default(true),
});

export const UpdateCategoryInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(80).optional(),
  isSecret: z.boolean().optional(),
  active: z.boolean().optional(),
});

// Category ids in the order they should be shown.
export const CategoryOrderInput = z.object({
  ids: z.array(id).refine((ids) => new Set(ids).size === ids.length, "Each category can appear once"),
});

// The whole item list of one category; array position is the display order.
export const CategoryItemsInput = z.object({
  items: z
    .array(z.object({ dishId: id, active: z.boolean().default(true) }))
    .refine((items) => new Set(items.map((i) => i.dishId)).size === items.length, "A dish can only be listed once"),
});
