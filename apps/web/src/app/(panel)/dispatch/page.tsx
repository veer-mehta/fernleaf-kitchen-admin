"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PERMISSIONS } from "@fernleaf/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ImageUpload } from "@/components/image-upload";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/native-select";
import { apiGet, apiPatch, apiPost, errorMessage } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { formatDate, formatTime } from "@/lib/format";
import { imageSrc } from "@/lib/safe-url";
import type { DispatchBoard, DispatchDrop, DropStep } from "@/lib/types";

const STATUS_LABEL = { OPEN: "Waiting for kitchen", DISPATCH_READY: "Ready for dispatch", OUT_FOR_DELIVERY: "Out for delivery", DELIVERED: "Delivered" } as const;
const STEP_LABEL: Record<DropStep, string> = { "dispatch-ready": "Mark ready for dispatch", "out-for-delivery": "Send out for delivery", delivered: "Mark delivered" };
const STAGE_LABEL: Record<string, string> = { COOKING: "cooking", KITCHEN_READY: "kitchen ready", DISPATCH_READY: "ready", OUT_FOR_DELIVERY: "out", DELIVERED: "delivered" };

function DropCard({ drop, drivers, canUpdate }: { drop: DispatchDrop; drivers: { id: number; name: string }[]; canUpdate: boolean }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["dispatch"] });
  const onError = (e: unknown) => { toast.error(errorMessage(e)); refresh(); };

  const advance = useMutation({
    mutationFn: (step: DropStep) =>
      apiPost(`/drops/${drop.id}/${step}`, step === "delivered" ? { ...(note ? { note } : {}), ...(photoUrl ? { photoUrl } : {}) } : undefined),
    onSuccess: refresh,
    onError,
  });
  const assign = useMutation({
    mutationFn: (driverId: number | null) => apiPatch(`/drops/${drop.id}/driver`, { driverId }),
    onSuccess: refresh,
    onError,
  });

  return (
    <Card className={drop.late ? "border-destructive" : ""}>
      <CardHeader className="flex-row flex-wrap items-center gap-2">
        <CardTitle className="text-base">{drop.deliveryTime} · {drop.company.name}</CardTitle>
        <Badge variant={drop.status === "DELIVERED" ? "default" : "secondary"}>{STATUS_LABEL[drop.status]}</Badge>
        {drop.late && <Badge variant="destructive">Late</Badge>}
        <span className="ml-auto text-sm text-muted-foreground">{drop.address.label}: {drop.address.line1}, {drop.address.city}</span>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="text-sm">
          {drop.orders.map((o) => (
            <li key={o.id}>#{o.id} · {o.employeeName} · {o.itemCount} item(s) · <span className="text-muted-foreground">{STAGE_LABEL[o.stage] ?? o.stage}</span></li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-2">Driver
            <NativeSelect aria-label={`Driver for the ${drop.deliveryTime} ${drop.company.name} drop`} disabled={!canUpdate || drop.status === "DELIVERED"} value={drop.driver?.id ?? ""} onChange={(e) => assign.mutate(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Unassigned</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </NativeSelect>
          </label>
          {!drop.driver && drop.status !== "DELIVERED" && <Badge className="bg-amber-500 text-white hover:bg-amber-500">No driver</Badge>}
        </div>
        {drop.nextAction === "delivered" && canUpdate && (
          <div className="flex flex-wrap gap-2">
            <Input className="max-w-xs" placeholder="Delivery note (optional)" aria-label="Delivery note" value={note} onChange={(e) => setNote(e.target.value)} />
            <ImageUpload label="Delivery photo (optional)" value={photoUrl} onChange={setPhotoUrl} />
          </div>
        )}
        {canUpdate && drop.nextAction && (
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={advance.isPending || !!drop.blocker} onClick={() => advance.mutate(drop.nextAction!)}>{STEP_LABEL[drop.nextAction]}</Button>
            {drop.blocker && <span className="text-sm text-muted-foreground">{drop.blocker}</span>}
          </div>
        )}
        {!drop.nextAction && drop.blocker && <p className="text-sm text-muted-foreground">{drop.blocker}</p>}
        {drop.status === "DELIVERED" && (
          <p className="text-sm text-muted-foreground">
            Delivered {drop.deliveredAt ? formatTime(drop.deliveredAt) : ""}
            {drop.note && <> · “{drop.note}”</>}
            {imageSrc(drop.photoUrl) && <> · <a className="underline" href={imageSrc(drop.photoUrl)} target="_blank" rel="noreferrer noopener">photo</a></>}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function DispatchPage() {
  const { can } = useMe();
  const [date, setDate] = useState("");
  const params = new URLSearchParams(date ? { date } : {});
  const { data: board, error } = useQuery({
    queryKey: ["dispatch", params.toString()],
    queryFn: () => apiGet<DispatchBoard>(`/dispatch/board?${params}`),
    refetchInterval: 20_000,
  });
  const { data: drivers = [] } = useQuery({ queryKey: ["drivers"], queryFn: () => apiGet<{ id: number; name: string }[]>("/drivers") });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Dispatch board</h1>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm"><span className="block text-xs text-muted-foreground">Delivery date</span>
          <input type="date" className="h-9 rounded-md border border-input bg-background px-2" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        {board && <p className="pb-2 text-sm text-muted-foreground">{formatDate(board.date)}</p>}
      </div>
      {error && <p className="text-destructive">{error.message}</p>}
      {board && (
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge variant="secondary">{board.totals.open} waiting for kitchen</Badge>
          <Badge variant="secondary">{board.totals.dispatchReady} ready</Badge>
          <Badge variant="secondary">{board.totals.outForDelivery} out</Badge>
          <Badge variant="secondary">{board.totals.delivered} delivered</Badge>
          {board.totals.unassigned > 0 && <Badge className="bg-amber-500 text-white hover:bg-amber-500">{board.totals.unassigned} without a driver</Badge>}
          {board.totals.late > 0 && <Badge variant="destructive">{board.totals.late} late</Badge>}
        </div>
      )}
      {board?.drops.length === 0 && <p className="text-muted-foreground">No deliveries for this date. Orders appear once their cut-off has passed.</p>}
      {board?.drops.map((d) => <DropCard key={d.id} drop={d} drivers={drivers} canUpdate={can(PERMISSIONS.DISPATCH_UPDATE)} />)}
    </div>
  );
}
