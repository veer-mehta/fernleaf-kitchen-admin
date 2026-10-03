import { OrderStatus } from "@prisma/client";
import { DomainError } from "../common/domain-error";

// What someone is trying to do to an existing order.
//   edit     - change its dishes (lines)
//   cancel   - cancel it
//   override - change delivery time, address or packaging (admin power)
export type ChangeKind = "edit" | "cancel" | "override";

interface Lockable {
  status: OrderStatus;
  cutoffAt: Date;
  invoiceId: number | null;
}

const locked = (message: string) => new DomainError("CUTOFF_PASSED", message, 409);

// The one place that decides whether an order may still be changed. Every edit, cancel and
// override calls it with the CURRENT time, so an order is locked from the cut-off instant
// onwards even if the background job that confirms orders has not run yet (the "lazy check").
// `canOverride` is the caller's orders:override permission, passed in as a plain boolean.
export function assertEditable(order: Lockable, kind: ChangeKind, now: Date, canOverride: boolean): void {
  // An invoiced order is part of a bill, so it is frozen until its invoice is voided.
  if (order.invoiceId !== null) {
    throw new DomainError("ORDER_INVOICED", "This order is on an invoice. Void the invoice first.", 409);
  }

  const pastCutoff = now.getTime() >= order.cutoffAt.getTime();

  if (kind === "edit") {
    if (order.status !== "DRAFT" && order.status !== "PLACED") {
      throw new DomainError("ORDER_NOT_EDITABLE", `A ${order.status.toLowerCase()} order cannot be edited`, 409);
    }
    // Not even an admin edits dishes after the cut-off: the kitchen plan is built from them.
    if (pastCutoff) throw locked("The cut-off for this delivery date has passed");
    return;
  }

  if (kind === "cancel") {
    if (order.status === "DELIVERED" || order.status === "CANCELLED" || order.status === "REJECTED") {
      throw new DomainError("ORDER_NOT_CANCELLABLE", `A ${order.status.toLowerCase()} order cannot be cancelled`, 409);
    }
    const needsOverride = order.status === "CONFIRMED" || pastCutoff;
    if (needsOverride && !canOverride) throw locked("This order is locked. Only an admin can cancel it now.");
    return;
  }

  // override
  if (order.status !== "PLACED" && order.status !== "CONFIRMED") {
    throw new DomainError("ORDER_NOT_EDITABLE", `A ${order.status.toLowerCase()} order cannot be changed`, 409);
  }
  if (!canOverride) throw locked("Only an admin can change a locked order");
}
