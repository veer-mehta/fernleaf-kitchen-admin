import { Prisma } from "@prisma/client";

// Adds one line to an order's timeline. `actor` is a person's name, or "System" for automatic steps.
export function addEvent(
  tx: Prisma.TransactionClient,
  orderId: number,
  type: string,
  actor: string,
  meta?: Prisma.InputJsonValue,
) {
  return tx.orderEvent.create({ data: { orderId, type, actor, meta } });
}
