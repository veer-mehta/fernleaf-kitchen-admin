"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { OrderBuilder } from "@/components/order-builder";
import { apiGet } from "@/lib/api";
import type { OrderDetail } from "@/lib/types";

export default function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: order, error } = useQuery({ queryKey: ["order", Number(id)], queryFn: () => apiGet<OrderDetail>(`/orders/${id}`) });
  if (error) return <p className="text-destructive">{error.message}</p>;
  if (!order) return <p className="text-muted-foreground">Loading…</p>;
  return <OrderBuilder key={order.id} existing={order} />;
}
