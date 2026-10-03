"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { INVOICE_STATUSES, PERMISSIONS, formatCents } from "@fernleaf/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/native-select";
import { Pagination } from "@/components/pagination";
import { StatusBadge } from "@/components/status-badge";
import { apiGet, apiPost, errorMessage } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import type { CompanyListItem, InvoiceDetail, InvoiceListItem, Paged, Uninvoiced } from "@/lib/types";

const PAGE_SIZE = 10;

function WaitingOrders({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["billing", "uninvoiced"], queryFn: () => apiGet<Uninvoiced>("/billing/uninvoiced") });
  const [selected, setSelected] = useState<Record<number, number[]>>({}); // companyId -> order ids

  const create = useMutation({
    mutationFn: (companyId: number) => apiPost<InvoiceDetail>("/invoices", { companyId, orderIds: selected[companyId] }),
    onSuccess: (invoice) => {
      toast.success(`Invoice #${invoice.id} created for ${formatCents(invoice.totalCents)}`);
      setSelected({});
      queryClient.invalidateQueries({ queryKey: ["billing"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => { toast.error(errorMessage(e)); queryClient.invalidateQueries({ queryKey: ["billing"] }); },
  });

  if (!data) return null;
  if (data.companies.length === 0) return <p className="text-muted-foreground">Every confirmed order has been invoiced.</p>;

  return (
    <div className="space-y-3">
      {data.companies.map((c) => {
        const chosen = selected[c.companyId] ?? [];
        const total = c.orders.filter((o) => chosen.includes(o.id)).reduce((sum, o) => sum + o.totalCents, 0);
        const toggle = (id: number) => setSelected({ ...selected, [c.companyId]: chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id] });
        return (
          <Card key={c.companyId}>
            <CardHeader className="flex-row flex-wrap items-center gap-2">
              <CardTitle className="text-base">{c.companyName}</CardTitle>
              <span className="text-sm text-muted-foreground">{c.orderCount} order(s) · {formatCents(c.totalCents)} not yet invoiced</span>
              {canWrite && (
                <div className="ml-auto flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setSelected({ ...selected, [c.companyId]: chosen.length === c.orders.length ? [] : c.orders.map((o) => o.id) })}>
                    {chosen.length === c.orders.length ? "Clear" : "Select all"}
                  </Button>
                  <Button size="sm" disabled={chosen.length === 0 || create.isPending} onClick={() => create.mutate(c.companyId)}>
                    Create invoice ({chosen.length}) {chosen.length > 0 && formatCents(total)}
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm">
                {c.orders.map((o) => (
                  <li key={o.id} className="flex items-center gap-2">
                    {canWrite && <input type="checkbox" aria-label={`Select order ${o.id}`} checked={chosen.includes(o.id)} onChange={() => toggle(o.id)} />}
                    <Link className="underline" href={`/orders/${o.id}`}>#{o.id}</Link>
                    <span>{formatDate(o.deliveryDate)} {o.deliveryTime}</span>
                    <span className="text-muted-foreground">{o.employeeName}</span>
                    <StatusBadge status={o.status} />
                    <span className="ml-auto">{formatCents(o.totalCents)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function InvoiceRow({ invoice, canWrite }: { invoice: InvoiceListItem; canWrite: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data: detail } = useQuery({ queryKey: ["invoice", invoice.id], queryFn: () => apiGet<InvoiceDetail>(`/invoices/${invoice.id}`), enabled: open });
  const refresh = () => {
    for (const key of ["invoices", "invoice", "billing", "dashboard"]) queryClient.invalidateQueries({ queryKey: [key] });
  };
  const act = useMutation({
    mutationFn: (action: "pay" | "void") => apiPost(`/invoices/${invoice.id}/${action}`),
    onSuccess: refresh,
    onError: (e) => { toast.error(errorMessage(e)); refresh(); },
  });
  return (
    <li className="rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <b>Invoice #{invoice.id}</b>
        <span>{invoice.company.name}</span>
        <Badge variant={invoice.status === "PAID" ? "default" : invoice.status === "VOID" ? "outline" : "secondary"}>{invoice.status[0] + invoice.status.slice(1).toLowerCase()}</Badge>
        <span className="text-muted-foreground">{invoice.orderCount} order(s) · {formatDateTime(invoice.createdAt)}{invoice.paidAt && ` · paid ${formatDateTime(invoice.paidAt)}`}</span>
        <b className="ml-auto">{formatCents(invoice.totalCents)}</b>
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>{open ? "Hide orders" : "Show orders"}</Button>
        {canWrite && invoice.status === "OPEN" && (
          <>
            <Button size="sm" disabled={act.isPending} onClick={() => act.mutate("pay")}>Mark paid</Button>
            <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate("void")}>Void</Button>
          </>
        )}
      </div>
      {open && detail && (
        <ul className="mt-2 space-y-1">
          {detail.orders.map((o) => <li key={o.id}><Link className="underline" href={`/orders/${o.id}`}>#{o.id}</Link> · {formatDate(o.deliveryDate)} · {o.employeeName} · {formatCents(o.totalCents)}</li>)}
          {detail.orders.length === 0 && <li className="text-muted-foreground">No orders (the invoice was voided and its orders released).</li>}
        </ul>
      )}
    </li>
  );
}

export default function BillingPage() {
  const { can } = useMe();
  const canWrite = can(PERMISSIONS.BILLING_WRITE);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [companyId, setCompanyId] = useState("");
  const { data: companies } = useQuery({ queryKey: ["companies", "all"], queryFn: () => apiGet<Paged<CompanyListItem>>("/companies?pageSize=100") });

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (status) params.set("status", status);
  if (companyId) params.set("companyId", companyId);
  const { data: invoices } = useQuery({ queryKey: ["invoices", params.toString()], queryFn: () => apiGet<Paged<InvoiceListItem>>(`/invoices?${params}`) });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Billing</h1>
      <section className="space-y-3">
        <h2 className="font-medium">Waiting to be invoiced</h2>
        <p className="text-sm text-muted-foreground">Every confirmed order is owed by its company. Tick the orders to bill together. An order can be on only one invoice, and an invoiced order is locked until its invoice is voided.</p>
        <WaitingOrders canWrite={canWrite} />
      </section>
      <section className="space-y-3">
        <h2 className="font-medium">Invoices</h2>
        <div className="flex flex-wrap gap-2">
          <NativeSelect aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">Any status</option>
            {INVOICE_STATUSES.map((s) => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Company" value={companyId} onChange={(e) => { setCompanyId(e.target.value); setPage(1); }}>
            <option value="">All companies</option>
            {companies?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </NativeSelect>
        </div>
        <ul className="space-y-2">{invoices?.items.map((i) => <InvoiceRow key={i.id} invoice={i} canWrite={canWrite} />)}</ul>
        {invoices?.items.length === 0 && <p className="text-muted-foreground">No invoices yet.</p>}
        <Pagination page={page} pageSize={PAGE_SIZE} total={invoices?.total ?? 0} onPage={setPage} />
      </section>
    </div>
  );
}
