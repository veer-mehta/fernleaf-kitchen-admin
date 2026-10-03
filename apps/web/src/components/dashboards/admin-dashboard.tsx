"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { formatCents } from "@fernleaf/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { AdminDashboard } from "@/lib/types";
import { Stat } from "./stat";

const STATUS_LABEL = { DRAFT: "Drafts", PLACED: "Placed", CONFIRMED: "Confirmed", DELIVERED: "Delivered", CANCELLED: "Cancelled", REJECTED: "Rejected" } as const;

export function AdminDashboardView() {
  const [date, setDate] = useState("");
  const { data } = useQuery({ queryKey: ["dashboard", "admin", date], queryFn: () => apiGet<AdminDashboard>(`/dashboard/admin${date ? `?date=${date}` : ""}`) });
  if (!data) return <p className="text-muted-foreground">Loading dashboard…</p>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center gap-3">
          <CardTitle className="text-base">Orders for {formatDate(data.date)}</CardTitle>
          <input type="date" aria-label="Delivery date" className="h-8 rounded-md border border-input bg-background px-2 text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">Orders whose <b>delivery date</b> is this day, counted by their current status. “Active” = every status except cancelled and rejected (drafts included); its value is the sum of those orders’ totals.</p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
            {(Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]).map((s) => <Stat key={s} label={STATUS_LABEL[s]} value={data.ordersByStatus[s]} />)}
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <Stat label="Active orders" value={data.activeOrders} />
            <Stat label="Active value" value={formatCents(data.activeValueCents)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Confirmed, not yet invoiced: {formatCents(data.uninvoiced.totalCents)}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">Money companies owe that has not been put on an invoice: confirmed or delivered orders with no invoice, <b>all delivery dates</b>. Cancelled and rejected orders are not included.</p>
          {data.uninvoiced.companies.length === 0 ? <p className="text-sm text-muted-foreground">Everything confirmed has been invoiced.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Company</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Owed</TableHead></TableRow></TableHeader>
              <TableBody>{data.uninvoiced.companies.map((c) => (
                <TableRow key={c.companyId}><TableCell>{c.companyName}</TableCell><TableCell className="text-right">{c.orderCount}</TableCell><TableCell className="text-right">{formatCents(c.totalCents)}</TableCell></TableRow>
              ))}</TableBody>
            </Table>
          )}
          <Link className="text-sm underline" href="/billing">Go to billing</Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Next 7 days: {data.upcoming.total} orders</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">Orders to deliver from {formatDate(data.upcoming.from)} to {formatDate(data.upcoming.to)} (today and the next 6 days), by delivery date. Cancelled and rejected orders are not counted.</p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-7">
            {data.upcoming.days.map((d) => <Stat key={d.date} label={formatDate(d.date).replace(/,? \d{4}$/, "")} value={d.count} />)}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Missing prices: {data.missingPrices.total}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">Active dishes and options with no price on a tier. Companies on that tier cannot order them. A dish with no price on a tier is hidden from those menus.</p>
          <Table>
            <TableHeader><TableRow><TableHead>Tier</TableHead><TableHead className="text-right">Dishes</TableHead><TableHead className="text-right">Options</TableHead></TableRow></TableHeader>
            <TableBody>{data.missingPrices.tiers.map((t) => (
              <TableRow key={t.tierId}><TableCell>{t.name}</TableCell>
                <TableCell className={`text-right ${t.dishes ? "font-semibold text-amber-600" : ""}`}>{t.dishes}</TableCell>
                <TableCell className={`text-right ${t.options ? "font-semibold text-amber-600" : ""}`}>{t.options}</TableCell></TableRow>
            ))}</TableBody>
          </Table>
          <Link className="text-sm underline" href="/pricing">Go to pricing</Link>
        </CardContent>
      </Card>
    </div>
  );
}
