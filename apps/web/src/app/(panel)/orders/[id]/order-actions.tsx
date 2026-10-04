"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PERMISSIONS } from "@fernleaf/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/native-select";
import { apiGet, apiPatch, apiPost, errorMessage, fieldErrors } from "@/lib/api";
import { useMe } from "@/lib/auth";
import type { CompanyDetail, OrderDetail, Packaging } from "@/lib/types";

// What staff can do with an order depends on its status. The buttons are a convenience:
// the server decides whether each action is allowed (permissions, cut-off, invoice lock).
export function OrderActions({ order }: { order: OrderDetail }) {
  const { can } = useMe();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [showOverride, setShowOverride] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["order", order.id] });
    queryClient.invalidateQueries({ queryKey: ["orders"] });
  };
  const act = useMutation({
    mutationFn: (v: { path: string; body?: object }) => apiPost<OrderDetail>(`/orders/${order.id}/${v.path}`, v.body),
    onSuccess: (updated) => {
      updated.warnings?.forEach((w) => toast.warning(w));
      toast.success("Done");
      setReason("");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const canWrite = can(PERMISSIONS.ORDERS_WRITE);
  const canOverride = can(PERMISSIONS.ORDERS_OVERRIDE);
  const { status } = order;
  const editable = status === "DRAFT" || status === "PLACED";
  const cancellable = status === "DRAFT" || status === "PLACED" || status === "CONFIRMED";
  if (!canWrite && !canOverride) return null;

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Actions</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {canWrite && editable && <Link href={`/orders/${order.id}/edit`} className={buttonVariants({ variant: "outline" })}>Edit dishes</Link>}
          {canWrite && status === "DRAFT" && <Button onClick={() => act.mutate({ path: "place" })} disabled={act.isPending}>Place order</Button>}
          {canOverride && status === "CONFIRMED" && !order.kitchenReadyAt && (
            <Button variant="outline" onClick={() => act.mutate({ path: "force-complete" })} disabled={act.isPending}>Complete in kitchen</Button>
          )}
          {canOverride && (status === "PLACED" || status === "CONFIRMED") && (
            <Button variant="outline" onClick={() => setShowOverride(!showOverride)}>Change delivery details</Button>
          )}
        </div>
        {cancellable && (canWrite || canOverride) && (
          <div className="flex flex-wrap items-center gap-2">
            <Input className="max-w-xs" placeholder="Reason (optional for cancel, required for reject)" aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            {canWrite && <Button variant="outline" onClick={() => act.mutate({ path: "cancel", body: reason ? { reason } : {} })} disabled={act.isPending}>Cancel order</Button>}
            {canOverride && status === "PLACED" && (
              <Button variant="outline" onClick={() => act.mutate({ path: "reject", body: { reason } })} disabled={act.isPending || !reason.trim()}>Reject order</Button>
            )}
          </div>
        )}
        {showOverride && canOverride && <OverrideForm order={order} onDone={() => { setShowOverride(false); refresh(); }} />}
        {order.invoiceId && <p className="text-sm text-muted-foreground">This order is on invoice #{order.invoiceId}, so it is locked until that invoice is voided.</p>}
      </CardContent>
    </Card>
  );
}

function OverrideForm({ order, onDone }: { order: OrderDetail; onDone: () => void }) {
  const { data: company } = useQuery({ queryKey: ["company", order.company.id], queryFn: () => apiGet<CompanyDetail>(`/companies/${order.company.id}`) });
  const [time, setTime] = useState(order.deliveryTime);
  const [addressId, setAddressId] = useState(String(order.address.id));
  const [packaging, setPackaging] = useState<Packaging>(order.packaging);
  const [errors, setErrors] = useState<Record<string, string> | undefined>();

  const save = useMutation({
    mutationFn: () => {
      // Only send what actually changed.
      const body: Record<string, unknown> = {};
      if (time !== order.deliveryTime) body.deliveryTime = time;
      if (Number(addressId) !== order.address.id) body.addressId = Number(addressId);
      if (packaging !== order.packaging) body.packaging = packaging;
      return apiPatch(`/orders/${order.id}/override`, body);
    },
    onSuccess: () => { toast.success("Delivery details changed"); onDone(); },
    onError: (e) => { setErrors(fieldErrors(e)); toast.error(errorMessage(e)); },
  });

  return (
    <form className="grid items-end gap-3 rounded-lg border p-3 md:grid-cols-[1fr_1fr_1fr_auto]" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <label className="space-y-1 text-sm">Delivery time
        <Input type="time" className="w-full" value={time} onChange={(e) => setTime(e.target.value)} />
        {errors?.deliveryTime && <span className="text-destructive">{errors.deliveryTime}</span>}
      </label>
      <label className="space-y-1 text-sm">Address
        <NativeSelect className="w-full" value={addressId} onChange={(e) => setAddressId(e.target.value)}>
          {company?.addresses.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </NativeSelect>
        {errors?.addressId && <span className="text-destructive">{errors.addressId}</span>}
      </label>
      <label className="space-y-1 text-sm">Packaging
        <NativeSelect className="w-full" value={packaging} onChange={(e) => setPackaging(e.target.value as Packaging)}>
          <option value="STANDARD">Standard</option><option value="ECO">Eco</option><option value="INSULATED">Insulated</option>
        </NativeSelect>
      </label>
      <Button type="submit" disabled={save.isPending}>Save changes</Button>
    </form>
  );
}
