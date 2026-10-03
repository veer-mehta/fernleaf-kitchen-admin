import { Badge } from "@/components/ui/badge";
import type { OrderStatus } from "@/lib/types";

const LABEL: Record<OrderStatus, string> = {
  DRAFT: "Draft", PLACED: "Placed", CONFIRMED: "Confirmed", DELIVERED: "Delivered", CANCELLED: "Cancelled", REJECTED: "Rejected",
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const variant = status === "CONFIRMED" || status === "DELIVERED" ? "default" : status === "CANCELLED" || status === "REJECTED" ? "outline" : "secondary";
  return <Badge variant={variant}>{LABEL[status]}</Badge>;
}
