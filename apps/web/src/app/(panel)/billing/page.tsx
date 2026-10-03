"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { INVOICE_STATUSES, PERMISSIONS, formatCents } from "@fernleaf/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckboxField } from "@/components/checkbox-field";
import { PageHeader } from "@/components/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/native-select";
import { Pagination } from "@/components/pagination";
import { usePageSize } from "@/lib/use-page-size";
import { StatusBadge } from "@/components/status-badge";
import { apiGet, apiPost, errorMessage } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import type { CompanyListItem, InvoiceDetail, InvoiceListItem, Paged, Uninvoiced } from "@/lib/types";


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
  if (data.companies.length === 0) return <p className="rounded-md border border-dashed py-8 text-center text-muted-foreground">Every confirmed order has been invoiced.</p>;

  return (
    <div className="space-y-6">
      {data.companies.map((c) => {
        const chosen = selected[c.companyId] ?? [];
        const total = c.orders.filter((o) => chosen.includes(o.id)).reduce((sum, o) => sum + o.totalCents, 0);
        const allChosen = chosen.length === c.orders.length;
        const toggle = (id: number) => setSelected({ ...selected, [c.companyId]: chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id] });
        return (
          <Card key={c.companyId}>
            <CardHeader className="flex flex-row flex-wrap items-center gap-x-4 gap-y-2">
              <div>
                <CardTitle className="text-base">{c.companyName}</CardTitle>
                <p className="text-sm text-muted-foreground">{c.orderCount} order(s) · {formatCents(c.totalCents)} not yet invoiced</p>
              </div>
              {canWrite && (
                <div className="ml-auto flex flex-wrap items-center gap-3">
                  <span className="text-sm text-muted-foreground">{chosen.length === 0 ? "Nothing selected" : `${chosen.length} selected · ${formatCents(total)}`}</span>
                  <Button disabled={chosen.length === 0 || create.isPending} onClick={() => create.mutate(c.companyId)}>
                    Create invoice
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    {canWrite && (
                      <TableHead className="w-10">
                        <CheckboxField
                          ariaLabel={`Select all orders for ${c.companyName}`}
                          checked={allChosen}
                          indeterminate={chosen.length > 0 && !allChosen}
                          onCheckedChange={(on) => setSelected({ ...selected, [c.companyId]: on ? c.orders.map((o) => o.id) : [] })}
                        />
                      </TableHead>
                    )}
                    <TableHead>Order</TableHead>
                    <TableHead>Delivery</TableHead>
                    <TableHead>Employee</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {c.orders.map((o) => (
                    <TableRow key={o.id} data-state={chosen.includes(o.id) ? "selected" : undefined}>
                      {canWrite && (
                        <TableCell>
                          <CheckboxField ariaLabel={`Select order ${o.id}`} checked={chosen.includes(o.id)} onCheckedChange={() => toggle(o.id)} />
                        </TableCell>
                      )}
                      <TableCell><Link className="font-medium underline-offset-4 hover:underline" href={`/orders/${o.id}`}>#{o.id}</Link></TableCell>
                      <TableCell>{formatDate(o.deliveryDate)} · {o.deliveryTime}</TableCell>
                      <TableCell>{o.employeeName}</TableCell>
                      <TableCell><StatusBadge status={o.status} /></TableCell>
                      <TableCell className="text-right tabular-nums">{formatCents(o.totalCents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
    <>
      <TableRow>
        <TableCell className="font-medium">#{invoice.id}</TableCell>
        <TableCell>{invoice.company.name}</TableCell>
        <TableCell><Badge variant={invoice.status === "PAID" ? "default" : invoice.status === "VOID" ? "outline" : "secondary"}>{invoice.status[0] + invoice.status.slice(1).toLowerCase()}</Badge></TableCell>
        <TableCell>{invoice.orderCount}</TableCell>
        <TableCell className="text-muted-foreground">{formatDateTime(invoice.createdAt)}{invoice.paidAt && ` · paid ${formatDateTime(invoice.paidAt)}`}</TableCell>
        <TableCell className="text-right tabular-nums font-medium">{formatCents(invoice.totalCents)}</TableCell>
        <TableCell>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>{open ? "Hide orders" : "Show orders"}</Button>
            {canWrite && invoice.status === "OPEN" && (
              <>
                <Button size="sm" disabled={act.isPending} onClick={() => act.mutate("pay")}>Mark paid</Button>
                <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate("void")}>Void</Button>
              </>
            )}
          </div>
        </TableCell>
      </TableRow>
      {open && detail && (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={7} className="whitespace-normal">
            <ul className="space-y-1 py-1 text-sm">
              {detail.orders.map((o) => <li key={o.id}><Link className="font-medium underline-offset-4 hover:underline" href={`/orders/${o.id}`}>#{o.id}</Link> · {formatDate(o.deliveryDate)} · {o.employeeName} · {formatCents(o.totalCents)}</li>)}
              {detail.orders.length === 0 && <li className="text-muted-foreground">No orders (the invoice was voided and its orders released).</li>}
            </ul>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export default function BillingPage() {
  const { can } = useMe();
  const canWrite = can(PERMISSIONS.BILLING_WRITE);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("invoices");
  const [status, setStatus] = useState("");
  const [companyId, setCompanyId] = useState("");
  const { data: companies } = useQuery({ queryKey: ["companies", "all"], queryFn: () => apiGet<Paged<CompanyListItem>>("/companies?pageSize=100") });

  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status) params.set("status", status);
  if (companyId) params.set("companyId", companyId);
  const { data: invoices } = useQuery({ queryKey: ["invoices", params.toString()], queryFn: () => apiGet<Paged<InvoiceListItem>>(`/invoices?${params}`) });

  return (
    <div className="space-y-8">
      <PageHeader title="Billing" description="Every confirmed order is owed by its company. Tick the orders to bill together. An order can be on only one invoice, and an invoiced order is locked until its invoice is voided." />
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Waiting to be invoiced</h2>
        <WaitingOrders canWrite={canWrite} />
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Invoices</h2>
        <div className="flex flex-wrap items-end gap-3">
          <NativeSelect aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">Any status</option>
            {INVOICE_STATUSES.map((s) => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Company" value={companyId} onChange={(e) => { setCompanyId(e.target.value); setPage(1); }}>
            <option value="">All companies</option>
            {companies?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </NativeSelect>
        </div>
        <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Orders</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices?.items.map((i) => <InvoiceRow key={i.id} invoice={i} canWrite={canWrite} />)}
              {invoices?.items.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No invoices yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        <Pagination page={page} pageSize={pageSize} onPageSize={(n) => { setPageSize(n); setPage(1); }} total={invoices?.total ?? 0} onPage={setPage} />
      </section>
    </div>
  );
}
