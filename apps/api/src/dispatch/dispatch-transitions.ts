import { OrderStatus } from "@prisma/client";
import { DomainError } from "../common/domain-error";

// Where a confirmed order is on its way out of the door. The order's own status stays CONFIRMED until
// delivery; the in-between stages are recorded by the timestamps (kitchenReadyAt, dispatchReadyAt...).
export type Stage = "COOKING" | "KITCHEN_READY" | "DISPATCH_READY" | "OUT_FOR_DELIVERY" | "DELIVERED";

interface StageFields {
  status: OrderStatus;
  kitchenReadyAt: Date | null;
  dispatchReadyAt: Date | null;
  outForDeliveryAt: Date | null;
  deliveredAt: Date | null;
}

// null = not a live order (still a draft or placed, or cancelled/rejected), so dispatch ignores it.
export function stageOf(o: StageFields): Stage | null {
  if (o.status === "DELIVERED") return "DELIVERED";
  if (o.status !== "CONFIRMED") return null;
  if (o.outForDeliveryAt) return "OUT_FOR_DELIVERY";
  if (o.dispatchReadyAt) return "DISPATCH_READY";
  if (o.kitchenReadyAt) return "KITCHEN_READY";
  return "COOKING";
}

const LABEL: Record<Stage, string> = {
  COOKING: "still being cooked",
  KITCHEN_READY: "kitchen ready",
  DISPATCH_READY: "ready for dispatch",
  OUT_FOR_DELIVERY: "out for delivery",
  DELIVERED: "delivered",
};

// The only legal moves: each stage has exactly one next stage.
const NEXT: Record<Stage, Stage | null> = {
  COOKING: "KITCHEN_READY", // done by the kitchen board, never by dispatch
  KITCHEN_READY: "DISPATCH_READY",
  DISPATCH_READY: "OUT_FOR_DELIVERY",
  OUT_FOR_DELIVERY: "DELIVERED",
  DELIVERED: null,
};

// Throws unless `from -> to` is the single next step. This is what stops skipping, repeating and going back.
export function assertTransition(from: Stage, to: Stage): void {
  if (from === "COOKING") {
    throw new DomainError("ORDERS_NOT_READY", `An order is ${LABEL[from]} and cannot be dispatched yet`, 409);
  }
  if (NEXT[from] !== to) {
    throw new DomainError("INVALID_TRANSITION", `The order is ${LABEL[from]}; it cannot go to "${LABEL[to]}" now`, 409);
  }
}
