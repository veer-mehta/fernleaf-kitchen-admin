"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PERMISSIONS } from "@fernleaf/shared";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/native-select";
import { UrgencyBadge } from "@/components/urgency-badge";
import { useReference } from "@/hooks/use-reference";
import { apiGet, apiPost, errorMessage } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { formatDate, formatTime } from "@/lib/format";
import type { KitchenBoard, KitchenUnit } from "@/lib/types";

const COLUMNS = [
  { status: "PENDING", title: "To cook" },
  { status: "STARTED", title: "Cooking" },
  { status: "DONE", title: "Done" },
] as const;

export default function KitchenPage() {
  const { can } = useMe();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(""); // empty = today (the server decides what today is)
  const [stationId, setStationId] = useState("");
  const stations = useReference("stations").data ?? [];

  const params = new URLSearchParams();
  if (date) params.set("date", date);
  if (stationId) params.set("stationId", stationId);
  // Refreshes itself every 20 seconds so several cooks see each other's progress.
  const { data: board, error } = useQuery({
    queryKey: ["kitchen", params.toString()],
    queryFn: () => apiGet<KitchenBoard>(`/kitchen/board?${params}`),
    refetchInterval: 20_000,
  });

  const act = useMutation({
    mutationFn: (v: { unitId: number; action: "start" | "done" }) => apiPost(`/kitchen/units/${v.unitId}/${v.action}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["kitchen"] }),
    onError: (e) => {
      // e.g. someone else already did it: show the server's message and show the true state.
      toast.error(errorMessage(e));
      queryClient.invalidateQueries({ queryKey: ["kitchen"] });
    },
  });
  const canWork = can(PERMISSIONS.KITCHEN_UPDATE);

  function UnitCard({ unit }: { unit: KitchenUnit }) {
    return (
      <div className={`space-y-1 rounded-md border p-2 text-sm ${unit.urgency === "late" ? "border-destructive" : unit.urgency === "at_risk" ? "border-amber-500" : ""}`}>
        <div className="flex items-start justify-between gap-2">
          <p><b>{unit.quantity} ×</b> {unit.dishName}</p>
          <UrgencyBadge urgency={unit.urgency} />
        </div>
        {unit.optionsSummary && <p className="text-muted-foreground">{unit.optionsSummary}</p>}
        <p className="text-xs text-muted-foreground">{unit.companyName} · order #{unit.orderId} · ready by {formatTime(unit.plannedKitchenReadyAt)}</p>
        {canWork && unit.status !== "DONE" && (
          <div className="flex gap-2 pt-1">
            {unit.status === "PENDING" && <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ unitId: unit.unitId, action: "start" })}>Start</Button>}
            <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate({ unitId: unit.unitId, action: "done" })}>Done</Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Kitchen board" />
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm"><span className="block text-xs text-muted-foreground">Delivery date</span>
          <Input type="date" className="w-44" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <NativeSelect aria-label="Station" value={stationId} onChange={(e) => setStationId(e.target.value)}>
          <option value="">All stations</option>
          {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          <option value="none">Unassigned</option>
        </NativeSelect>
        {board && <p className="pb-2 text-sm text-muted-foreground">{formatDate(board.date)}</p>}
      </div>
      {error && <p className="text-destructive">{error.message}</p>}
      {board && (
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge variant="secondary">{board.totals.pending} to cook</Badge>
          <Badge variant="secondary">{board.totals.started} cooking</Badge>
          <Badge variant="secondary">{board.totals.done} done</Badge>
          {board.totals.late > 0 && <Badge variant="destructive">{board.totals.late} late</Badge>}
          {board.totals.atRisk > 0 && <Badge className="bg-amber-500 text-white hover:bg-amber-500">{board.totals.atRisk} at risk</Badge>}
        </div>
      )}
      {board?.stations.length === 0 && <p className="text-muted-foreground">Nothing to cook for this date. Only confirmed orders appear here.</p>}
      {board?.stations.map((station) => (
        <Card key={station.stationId ?? "none"}>
          <CardHeader><CardTitle className="text-base">{station.name}</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            {COLUMNS.map((col) => {
              const units = station.units.filter((u) => u.status === col.status);
              return (
                <div key={col.status} className="space-y-2 rounded-lg bg-muted/40 p-2">
                  <p className="flex items-center gap-2 px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {col.title} <Badge variant="secondary">{units.length}</Badge>
                  </p>
                  {units.length === 0 && <p className="px-1 py-4 text-center text-sm text-muted-foreground">Nothing here</p>}
                  {units.map((u) => <UnitCard key={u.unitId} unit={u} />)}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
