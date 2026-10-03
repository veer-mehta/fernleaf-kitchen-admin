import { z } from "zod";
import { PACKAGING } from "./companies";
import { isoDate } from "./settings";

const id = z.number().int().positive();

// What the client may send when placing or saving an order. Note what is NOT here: prices,
// totals, names. The server works all of those out itself, and .strict() turns any extra key
// (such as a "totalCents" someone adds by hand) into a validation error instead of ignoring it.
const Selection = z
  .object({
    groupId: id,
    optionId: id,
    portionSizeId: id.optional(), // [Should] portions
  })
  .strict();

const Combination = z
  .object({
    quantity: z.number().int("Quantity must be a whole number").min(1, "Quantity must be at least 1"),
    selections: z.array(Selection).default([]),
  })
  .strict();

const Line = z
  .object({
    dishId: id,
    quantity: z.number().int("Quantity must be a whole number").min(1, "Quantity must be at least 1"),
    combinations: z.array(Combination).min(1, "Add at least one combination"),
  })
  .strict();

export const OrderInput = z
  .object({
    employeeId: id,
    deliveryDate: isoDate,
    // Left out = the company's default. Only employees allowed to change these may differ from it.
    deliveryTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use the 24-hour format HH:mm").optional(),
    addressId: id.optional(),
    packaging: z.enum(PACKAGING).optional(),
    status: z.enum(["DRAFT", "PLACED"]).default("PLACED"),
    lines: z.array(Line).min(1, "Add at least one dish"),
  })
  .strict();

export const CancelInput = z.object({ reason: z.string().trim().max(300).optional() }).strict();
export const RejectInput = z.object({ reason: z.string().trim().min(1, "Give a reason").max(300) }).strict();

// An admin changing delivery details after the order is locked. At least one field must be sent.
export const OverrideInput = z
  .object({
    deliveryTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use the 24-hour format HH:mm").optional(),
    addressId: id.optional(),
    packaging: z.enum(PACKAGING).optional(),
  })
  .strict()
  .refine((v) => v.deliveryTime !== undefined || v.addressId !== undefined || v.packaging !== undefined, "Change at least one thing");
export type OrderInputType = z.infer<typeof OrderInput>;

export const ProcessCutoffInput = z.object({ date: isoDate }).strict();

export const ORDER_STATUSES = ["DRAFT", "PLACED", "CONFIRMED", "DELIVERED", "CANCELLED", "REJECTED"] as const;

export const OrderListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  from: isoDate.optional(), // delivery date range, both ends included
  to: isoDate.optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  companyId: z.coerce.number().int().positive().optional(),
  invoiced: z.enum(["true", "false"]).optional(),
  search: z.string().trim().optional(), // order number, employee name or email, or company name
});
