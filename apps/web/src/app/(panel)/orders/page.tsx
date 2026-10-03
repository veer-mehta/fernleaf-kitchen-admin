"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ORDER_STATUSES, PERMISSIONS, formatCents } from "@fernleaf/shared";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/native-select";
import { Pagination } from "@/components/pagination";
import { usePageSize } from "@/lib/use-page-size";
import { StatusBadge } from "@/components/status-badge";
import { apiGet, apiPost, errorMessage } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import type { CompanyListItem, OrderListItem, Paged } from "@/lib/types";


// For admins: runs the cut-off for a delivery date whose cut-off has already passed, so drafts
// are cancelled and placed orders confirmed without waiting for the background job.
function RunCutoff() {
  const queryClient = useQueryClient();
  const [date, setDate] = useState("");
  const run = useMutation({
    mutationFn: () => apiPost<{ date: string; cancelled: number; confirmed: number }>("/orders/process-cutoff", { date }),
    onSuccess: (r) => {
      toast.success(`Cut-off for ${r.date}: ${r.confirmed} order(s) confirmed, ${r.cancelled} draft(s) cancelled`);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="space-y-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Run cut-off processing for delivery date</span>
          <Input type="date" className="w-44" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <Button variant="outline" onClick={() => run.mutate()} disabled={!date || run.isPending}>Run now</Button>
      </div>
      <p className="text-xs text-muted-foreground">Cancels drafts and confirms placed orders for that day. Only possible once its cut-off has passed. Safe to run twice.</p>
    </div>
  );
}

export default function OrdersPage() {
  const { can } = useMe();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("orders");
  const [filters, setFilters] = useState({ from: "", to: "", status: "", companyId: "", invoiced: "", search: "" });
  const { data: companies } = useQuery({
    queryKey: ["companies", "all"],
    queryFn: () => apiGet<Paged<CompanyListItem>>("/companies?pageSize=100"),
    retry: false, // roles without companies:read just get no company filter
  });

  const set = (key: keyof typeof filters) => (value: string) => { setFilters({ ...filters, [key]: value }); setPage(1); };
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  const { data } = useQuery({ queryKey: ["orders", params.toString()], queryFn: () => apiGet<Paged<OrderListItem>>(`/orders?${params}`) });

  return (
    <div className="space-y-6">
      <PageHeader title="Orders"
        actions={<>{can(PERMISSIONS.ORDERS_WRITE) && <Link href="/orders/new" className={buttonVariants()}>New order</Link>}</>}
      />
      {can(PERMISSIONS.ORDERS_OVERRIDE) && <RunCutoff />}
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <label className="space-y-1"><span className="block text-xs text-muted-foreground">Delivery from</span>
          <Input type="date" className="w-44" value={filters.from} onChange={(e) => set("from")(e.target.value)} /></label>
        <label className="space-y-1"><span className="block text-xs text-muted-foreground">to</span>
          <Input type="date" className="w-44" value={filters.to} onChange={(e) => set("to")(e.target.value)} /></label>
        <NativeSelect aria-label="Status" value={filters.status} onChange={(e) => set("status")(e.target.value)}>
          <option value="">Any status</option>
          {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>)}
        </NativeSelect>
        {companies && (
          <NativeSelect aria-label="Company" value={filters.companyId} onChange={(e) => set("companyId")(e.target.value)}>
            <option value="">All companies</option>
            {companies.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </NativeSelect>
        )}
        <NativeSelect aria-label="Invoiced" value={filters.invoiced} onChange={(e) => set("invoiced")(e.target.value)}>
          <option value="">Invoiced or not</option>
          <option value="true">Invoiced</option>
          <option value="false">Not invoiced</option>
        </NativeSelect>
        <Input className="w-56" placeholder="Order #, employee or company" value={filters.search} onChange={(e) => set("search")(e.target.value)} />
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Delivery</TableHead><TableHead>Company</TableHead><TableHead>Employee</TableHead><TableHead>Items</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead><TableHead>Invoiced</TableHead></TableRow></TableHeader>
        <TableBody>
          {data?.items.map((o) => (
            <TableRow key={o.id}>
              <TableCell><Link className="underline" href={`/orders/${o.id}`}>#{o.id}</Link></TableCell>
              <TableCell>{formatDate(o.deliveryDate)} {o.deliveryTime}</TableCell>
              <TableCell>{o.company.name}</TableCell>
              <TableCell>{o.employee.name}</TableCell>
              <TableCell>{o.itemCount}</TableCell>
              <TableCell>{formatCents(o.totalCents)}</TableCell>
              <TableCell><StatusBadge status={o.status} /></TableCell>
              <TableCell>{o.invoiced ? "Yes" : "–"}</TableCell>
            </TableRow>
          ))}
          {data?.items.length === 0 && <TableRow><TableCell colSpan={8} className="text-muted-foreground">No orders match.</TableCell></TableRow>}
        </TableBody>
      </Table>
      <Pagination page={page} pageSize={pageSize} onPageSize={(n) => { setPageSize(n); setPage(1); }} total={data?.total ?? 0} onPage={setPage} />
    </div>
  );
}
