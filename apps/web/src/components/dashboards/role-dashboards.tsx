"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UrgencyBadge } from "@/components/urgency-badge";
import { apiGet } from "@/lib/api";
import { formatDate, formatTime } from "@/lib/format";
import type { DispatchDashboard, DriverDashboard, KitchenDashboard } from "@/lib/types";
import { Stat } from "./stat";

export function KitchenDashboardView() {
  const { data } = useQuery({ queryKey: ["dashboard", "kitchen"], queryFn: () => apiGet<KitchenDashboard>("/dashboard/kitchen"), refetchInterval: 30_000 });
  if (!data) return <p className="text-muted-foreground">Loading dashboard…</p>;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Kitchen today · {formatDate(data.date)}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">Prep units of <b>confirmed</b> orders delivering today (one unit = one distinct combination). <b>Late</b> = not done and past the order’s kitchen-ready time; <b>at risk</b> = not done and within 30 minutes of it.</p>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <Stat label="To cook" value={data.totals.pending} />
          <Stat label="Cooking" value={data.totals.started} />
          <Stat label="Done" value={data.totals.done} />
          <Stat label="Late" value={data.totals.late} tone={data.totals.late ? "bad" : undefined} />
          <Stat label="At risk" value={data.totals.atRisk} tone={data.totals.atRisk ? "warn" : undefined} />
        </div>
        {data.stations.length > 0 && (
          <Table>
            <TableHeader><TableRow><TableHead>Station</TableHead><TableHead className="text-right">To cook</TableHead><TableHead className="text-right">Cooking</TableHead><TableHead className="text-right">Done</TableHead></TableRow></TableHeader>
            <TableBody>{data.stations.map((s) => (
              <TableRow key={s.stationId ?? "none"}><TableCell>{s.name}</TableCell><TableCell className="text-right">{s.counts.pending}</TableCell><TableCell className="text-right">{s.counts.started}</TableCell><TableCell className="text-right">{s.counts.done}</TableCell></TableRow>
            ))}</TableBody>
          </Table>
        )}
        <p className="text-sm font-medium">Next deadlines</p>
        {data.nextDeadlines.length === 0 ? <p className="text-sm text-muted-foreground">Nothing left to cook today.</p> : (
          <ul className="space-y-1 text-sm">{data.nextDeadlines.map((d) => (
            <li key={d.orderId} className="flex items-center gap-2">
              <b>{formatTime(d.plannedKitchenReadyAt)}</b> {d.companyName} · order #{d.orderId} · {d.unitsLeft} unit(s) left <UrgencyBadge urgency={d.urgency} />
            </li>
          ))}</ul>
        )}
        <Link className="text-sm underline" href="/kitchen">Open the kitchen board</Link>
      </CardContent>
    </Card>
  );
}

export function DispatchDashboardView() {
  const { data } = useQuery({ queryKey: ["dashboard", "dispatch"], queryFn: () => apiGet<DispatchDashboard>("/dashboard/dispatch"), refetchInterval: 30_000 });
  if (!data) return <p className="text-muted-foreground">Loading dashboard…</p>;
  const rate = data.onTime.ratePercent;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Dispatch today · {formatDate(data.date)}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">Drops (orders for the same company, address and time) delivering today. <b>Late</b> = not delivered and past its delivery time. <b>On-time rate</b> = drops delivered by their delivery time (plus the grace setting) ÷ drops delivered; shown as “none yet” until something is delivered.</p>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
          <Stat label="Waiting for kitchen" value={data.totals.open} />
          <Stat label="Ready" value={data.totals.dispatchReady} />
          <Stat label="Out" value={data.totals.outForDelivery} />
          <Stat label="Delivered" value={data.totals.delivered} />
          <Stat label="No driver" value={data.totals.unassigned} tone={data.totals.unassigned ? "warn" : undefined} />
          <Stat label="Late" value={data.totals.late} tone={data.totals.late ? "bad" : undefined} />
        </div>
        <Stat label="On-time rate" value={rate === null ? "none yet" : `${rate}%`} hint={rate === null ? "No drop has been delivered today." : `${data.onTime.onTime} of ${data.onTime.delivered} delivered drops were on time.`} />
        {data.lateDrops.length > 0 && (
          <ul className="space-y-1 text-sm">{data.lateDrops.map((d) => <li key={d.id}><Badge variant="destructive">Late</Badge> {d.deliveryTime} · {d.company}</li>)}</ul>
        )}
        <Link className="text-sm underline" href="/dispatch">Open the dispatch board</Link>
      </CardContent>
    </Card>
  );
}

export function DriverDashboardView() {
  const { data } = useQuery({ queryKey: ["dashboard", "driver"], queryFn: () => apiGet<DriverDashboard>("/dashboard/driver"), refetchInterval: 30_000 });
  if (!data) return <p className="text-muted-foreground">Loading dashboard…</p>;
  return (
    <Card className="mx-auto max-w-md">
      <CardHeader><CardTitle className="text-base">My deliveries today · {formatDate(data.date)}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">Only drops assigned to you for today, in delivery-time order.</p>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Total" value={data.counts.total} />
          <Stat label="Delivered" value={data.counts.delivered} />
          <Stat label="To go" value={data.counts.remaining} />
        </div>
        <ul className="space-y-1 text-sm">{data.drops.map((d) => <li key={d.id}><b>{d.deliveryTime}</b> {d.company} · {d.status.toLowerCase().replace(/_/g, " ")}</li>)}</ul>
        {data.drops.length === 0 && <p className="text-sm text-muted-foreground">No deliveries assigned to you today.</p>}
        <Link className="inline-block rounded-md bg-primary px-4 py-3 text-primary-foreground" href="/driver">Open my deliveries</Link>
      </CardContent>
    </Card>
  );
}
