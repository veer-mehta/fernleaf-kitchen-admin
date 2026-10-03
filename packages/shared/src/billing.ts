import { z } from "zod";
import { PageQuery } from "./pagination";

const id = z.number().int().positive();

export const CreateInvoiceInput = z
  .object({
    companyId: id,
    orderIds: z
      .array(id)
      .min(1, "Select at least one order")
      .refine((ids) => new Set(ids).size === ids.length, "An order can only be selected once"),
  })
  .strict();

export const UninvoicedQuery = z.object({ companyId: z.coerce.number().int().positive().optional() });

export const INVOICE_STATUSES = ["OPEN", "PAID", "VOID"] as const;
export const InvoiceListQuery = PageQuery.extend({
  companyId: z.coerce.number().int().positive().optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
});
