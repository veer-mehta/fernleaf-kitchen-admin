"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { formatCents } from "@fernleaf/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { apiGet } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import type { OrderDetail } from "@/lib/types";
import { OrderActions } from "./order-actions";

const EVENT_LABEL: Record<string, string> = {
  CREATED: "Order created", PLACED: "Placed", EDITED: "Edited", CONFIRMED: "Confirmed at cut-off", CANCELLED: "Cancelled",
  REJECTED: "Rejected", OVERRIDDEN: "Delivery details changed", KITCHEN_STARTED: "Kitchen started", KITCHEN_READY: "Kitchen ready",
  DISPATCH_READY: "Ready for dispatch", OUT_FOR_DELIVERY: "Out for delivery", DELIVERED: "Delivered", FORCE_COMPLETED: "Completed by admin",
};

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-sm">{children}</dd></div>);
}

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: order, error } = useQuery({ queryKey: ["order", Number(id)], queryFn: () => apiGet<OrderDetail>(`/orders/${id}`) });
  if (error) return <p className="text-destructive">{error.message}</p>;
  if (!order) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-4">
      <Link className="text-sm underline" href="/orders">← All orders</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Order #{order.id}</h1>
        <StatusBadge status={order.status} />
        {order.invoiceId && <span className="text-sm text-muted-foreground">Invoice #{order.invoiceId}</span>}
        <span className="ml-auto text-xl font-semibold">{formatCents(order.totalCents)}</span>
      </div>
      {order.rejectionReason && <p className="rounded-md border p-2 text-sm">Rejected: {order.rejectionReason}</p>}

      <Card>
        <CardHeader><CardTitle className="text-base">Delivery</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid gap-3 md:grid-cols-3">
            <Fact label="Company">{order.company.name}</Fact>
            <Fact label="Employee">{order.employee.name}<br /><span className="text-muted-foreground">{order.employee.email}</span></Fact>
            <Fact label="Delivery">{formatDate(order.deliveryDate)} at {order.deliveryTime}</Fact>
            <Fact label="Address">{order.address.label}: {order.address.line1}, {order.address.city} {order.address.postalCode}</Fact>
            <Fact label="Packaging">{order.packaging.toLowerCase()}</Fact>
            <Fact label="Orders lock at">{formatDateTime(order.cutoffAt)}</Fact>
            <Fact label="Kitchen must be ready by">{formatDateTime(order.plannedKitchenReadyAt)}</Fact>
            <Fact label="Ready for dispatch by">{formatDateTime(order.plannedDispatchReadyAt)}</Fact>
            {order.deliveredAt && <Fact label="Delivered">{formatDateTime(order.deliveredAt)} {order.onTime === null ? "" : order.onTime ? "(on time)" : "(late)"}</Fact>}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">What was ordered</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Dish</TableHead><TableHead>Choices</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Each</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
            <TableBody>
              {order.lines.map((line) =>
                line.combinations.map((c, i) => (
                  <TableRow key={c.id}>
                    <TableCell>{i === 0 ? <><b>{line.dishName}</b><br /><span className="text-xs text-muted-foreground">{line.sku}{line.station ? ` · ${line.station}` : ""}</span></> : ""}</TableCell>
                    <TableCell className="text-sm">{c.options.length ? c.options.map((o) => `${o.optionName}${o.portion ? ` (${o.portion})` : ""}${o.priceCents ? ` +${formatCents(o.priceCents)}` : ""}`).join(", ") : "–"}</TableCell>
                    <TableCell className="text-right">{c.quantity}</TableCell>
                    <TableCell className="text-right">{formatCents(c.unitPriceCents)}</TableCell>
                    <TableCell className="text-right">{formatCents(c.lineTotalCents)}</TableCell>
                  </TableRow>
                )),
              )}
              <TableRow><TableCell colSpan={4} className="text-right font-medium">Order total</TableCell><TableCell className="text-right font-semibold">{formatCents(order.totalCents)}</TableCell></TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <OrderActions order={order} />

      <Card>
        <CardHeader><CardTitle className="text-base">Timeline</CardTitle></CardHeader>
        <CardContent>
          <ol className="space-y-2 text-sm">
            {order.timeline.map((e, i) => (
              <li key={i} className="flex flex-wrap gap-x-3">
                <span className="w-32 text-muted-foreground">{formatDateTime(e.at)}</span>
                <span className="font-medium">{EVENT_LABEL[e.type] ?? e.type}</span>
                <span className="text-muted-foreground">by {e.actor}</span>
                {typeof e.meta?.reason === "string" && <span>“{e.meta.reason}”</span>}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
