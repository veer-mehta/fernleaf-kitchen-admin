"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PERMISSIONS } from "@fernleaf/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/form-field";
import { apiDelete, apiGet, apiPost, apiPut, errorMessage, fieldErrors } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { WEEKDAY_NAMES, formatDate } from "@/lib/format";
import type { KitchenSettings } from "@/lib/types";

function SettingsForm({ settings, canEdit }: { settings: KitchenSettings; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [workingDays, setWorkingDays] = useState(settings.workingDays);
  const [cutoffTime, setCutoffTime] = useState(settings.cutoffTime);
  const [cutoffDays, setCutoffDays] = useState(String(settings.cutoffWorkingDays));
  const [buffer, setBuffer] = useState(String(settings.kitchenReadyBufferMinutes));
  const [grace, setGrace] = useState(String(settings.onTimeGraceMinutes));
  const [errors, setErrors] = useState<Record<string, string> | undefined>();

  const save = useMutation({
    mutationFn: () =>
      apiPut("/settings", {
        workingDays,
        cutoffTime,
        cutoffWorkingDays: Number(cutoffDays),
        kitchenReadyBufferMinutes: Number(buffer),
        onTimeGraceMinutes: Number(grace),
      }),
    onSuccess: () => { setErrors(undefined); toast.success("Settings saved"); queryClient.invalidateQueries({ queryKey: ["settings"] }); },
    onError: (e) => { setErrors(fieldErrors(e)); toast.error(errorMessage(e)); },
  });
  const toggleDay = (day: number) => setWorkingDays(workingDays.includes(day) ? workingDays.filter((d) => d !== day) : [...workingDays, day].sort());

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Kitchen rules</CardTitle></CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <fieldset disabled={!canEdit} className="space-y-4">
            <p className="text-sm">Time zone: <b>{settings.timezone}</b> <span className="text-muted-foreground">(every cut-off, delivery date and “today” uses this, whatever the server or browser zone)</span></p>
            <div>
              <p className="mb-1 text-sm font-medium">Kitchen working days</p>
              <div className="flex flex-wrap gap-3">
                {WEEKDAY_NAMES.map((label, i) => (
                  <label key={label} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={workingDays.includes(i + 1)} onChange={() => toggleDay(i + 1)} /> {label}</label>
                ))}
              </div>
              {errors && Object.keys(errors).some((k) => k.startsWith("workingDays")) && <p className="text-sm text-destructive">Pick at least one working day</p>}
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <FormField name="cutoffTime" label="Cut-off time (HH:mm)" value={cutoffTime} onChange={(e) => setCutoffTime(e.target.value)} errors={errors} />
              <FormField name="cutoffWorkingDays" label="Cut-off: working days before delivery" inputMode="numeric" value={cutoffDays} onChange={(e) => setCutoffDays(e.target.value)} errors={errors} />
              <FormField name="kitchenReadyBufferMinutes" label="Kitchen-ready buffer (minutes)" inputMode="numeric" value={buffer} onChange={(e) => setBuffer(e.target.value)} errors={errors} />
              <FormField name="onTimeGraceMinutes" label="On-time grace (minutes)" inputMode="numeric" value={grace} onChange={(e) => setGrace(e.target.value)} errors={errors} />
            </div>
            <p className="text-xs text-muted-foreground">Orders for a delivery date lock at the cut-off time, this many <b>kitchen</b> working days before it (the company’s own calendar never moves it). Example: 2 days at 16:00 means a Wednesday delivery locks Monday 16:00.</p>
          </fieldset>
          {canEdit && <Button type="submit" disabled={save.isPending}>Save settings</Button>}
        </form>
      </CardContent>
    </Card>
  );
}

function Holidays({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["kitchen-holidays"], queryFn: () => apiGet<{ id: number; date: string; name: string }[]>("/kitchen-holidays") });
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<Record<string, string> | undefined>();
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ["kitchen-holidays"] }); queryClient.invalidateQueries({ queryKey: ["settings"] }); };

  const add = useMutation({
    mutationFn: () => apiPost("/kitchen-holidays", { date, name }),
    onSuccess: () => { setDate(""); setName(""); setErrors(undefined); refresh(); },
    onError: (e) => { setErrors(fieldErrors(e)); toast.error(errorMessage(e)); },
  });
  const remove = useMutation({ mutationFn: (id: number) => apiDelete(`/kitchen-holidays/${id}`), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Kitchen holidays</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">Days the kitchen is closed. They are skipped when counting back to a cut-off, so adding one moves earlier the lock time of the orders after it.</p>
        <ul className="space-y-1 text-sm">
          {data.map((h) => (
            <li key={h.id} className="flex items-center gap-2"><span className="flex-1">{formatDate(h.date)} {h.name && `· ${h.name}`}</span>
              {canEdit && <Button size="sm" variant="ghost" onClick={() => remove.mutate(h.id)}>Remove</Button>}</li>
          ))}
          {data.length === 0 && <li className="text-muted-foreground">None.</li>}
        </ul>
        {canEdit && (
          <form className="flex flex-wrap items-start gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
            <div className="w-44"><FormField name="date" label="" type="date" aria-label="Holiday date" value={date} onChange={(e) => setDate(e.target.value)} errors={errors} /></div>
            <input className="h-9 w-56 rounded-md border border-input bg-background px-3 text-sm" placeholder="Name (optional)" aria-label="Holiday name" value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" disabled={!date}>Add holiday</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

// The demo orders are generated around "today", so after a night or a long gap they can be stale.
// This button rebuilds them around today. Orders created by hand are never touched.
function DemoData() {
  const queryClient = useQueryClient();
  const refresh = useMutation({
    mutationFn: () => apiPost<{ today: string; orders: number; drops: number }>("/demo/refresh"),
    onSuccess: (r) => {
      toast.success(`Demo data rebuilt around ${r.today}: ${r.orders} orders in ${r.drops} drops`);
      queryClient.invalidateQueries(); // every screen may now show different data
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Demo data</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">The sample orders, drops and invoices are generated around today’s date (six days back, a week ahead), so there is always something on the boards. This rebuilds them. It runs by itself at start-up on a new day. Orders you created yourself, and demo orders that are on a real invoice, are kept.</p>
        <Button variant="outline" disabled={refresh.isPending} onClick={() => refresh.mutate()}>{refresh.isPending ? "Rebuilding…" : "Refresh demo data"}</Button>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const { can } = useMe();
  const canEdit = can(PERMISSIONS.SETTINGS_WRITE);
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => apiGet<KitchenSettings>("/settings") });
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      {settings ? <SettingsForm key={JSON.stringify(settings)} settings={settings} canEdit={canEdit} /> : <p className="text-muted-foreground">Loading…</p>}
      <Holidays canEdit={canEdit} />
      {canEdit && <DemoData />}
    </div>
  );
}
