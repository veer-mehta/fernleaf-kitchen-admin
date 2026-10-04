"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PERMISSIONS, formatCents, formatScaled } from "@fernleaf/shared";
import { PageHeader } from "@/components/page-header";
import { CheckboxField } from "@/components/checkbox-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CentsInput } from "@/components/cents-input";
import { apiDelete, apiGet, apiPatch, apiPut, errorMessage } from "@/lib/api";
import { useMe } from "@/lib/auth";
import type { MissingReport, Tier, TierGrid } from "@/lib/types";
import { TierForm } from "./tier-form";

function describe(tier: Tier, all: Tier[]) {
  const d = tier.derivation;
  if (d.type === "COST_MULTIPLE") return `Cost × ${formatScaled(d.multiplierMilli, 3)}`;
  if (d.type === "TIER_PERCENT") {
    const base = all.find((t) => t.id === d.baseTierId)?.name ?? "?";
    return `${base} ${d.percentBp >= 0 ? "+" : "−"} ${formatScaled(Math.abs(d.percentBp), 2)}%`;
  }
  return "Prices typed in by hand";
}

function TierDetail({ tier, tiers, canEdit }: { tier: Tier; tiers: Tier[]; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [editingRule, setEditingRule] = useState(false);
  const [onlyMissing, setOnlyMissing] = useState(false);

  const { data: grid } = useQuery({ queryKey: ["grid", tier.id], queryFn: () => apiGet<TierGrid>(`/tiers/${tier.id}/grid`) });
  const { data: missing } = useQuery({ queryKey: ["missing", tier.id], queryFn: () => apiGet<MissingReport>(`/tiers/${tier.id}/missing`) });

  // Prices on one tier can change other tiers (derived ones), so refresh every grid.
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["grid"] });
    queryClient.invalidateQueries({ queryKey: ["missing"] });
  };
  const onError = (e: unknown) => toast.error(errorMessage(e));

  // Empty box = remove the price (a derived tier then refills it); a number = a manual price.
  const setPrice = useMutation({
    mutationFn: (v: { kind: "dish" | "option"; id: number; cents: number | null }) =>
      v.cents === null
        ? apiDelete(`/tiers/${tier.id}/${v.kind}-prices/${v.id}`)
        : apiPut(`/tiers/${tier.id}/${v.kind}-prices/${v.id}`, { cents: v.cents }),
    onSuccess: refresh,
    onError,
  });
  const makeDefault = useMutation({
    mutationFn: () => apiPatch(`/tiers/${tier.id}`, { isDefault: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tiers"] }),
    onError,
  });

  const missingCount = (missing?.dishes.length ?? 0) + (missing?.options.length ?? 0);
  const dishes = (grid?.dishes ?? []).filter((d) => !onlyMissing || d.priceCents === null);
  const options = (grid?.options ?? []).filter((o) => !onlyMissing || o.priceCents === null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{tier.name}</h2>
        {tier.isDefault && <Badge>Default</Badge>}
        <span className="text-sm text-muted-foreground">{describe(tier, tiers)}</span>
        {canEdit && (
          <div className="ml-auto flex gap-2">
            {!tier.isDefault && <Button size="sm" variant="outline" onClick={() => makeDefault.mutate()}>Make default</Button>}
            <Button size="sm" variant="outline" onClick={() => setEditingRule(!editingRule)}>{editingRule ? "Close" : "Edit rule"}</Button>
          </div>
        )}
      </div>
      {editingRule && <TierForm key={tier.id} tier={tier} allTiers={tiers} onDone={() => setEditingRule(false)} />}

      <div className={`space-y-3 rounded-lg border p-3 text-sm ${missingCount ? "border-amber-400" : ""}`}>
        <p>
          {missingCount === 0 ? (
            "Every active dish and option has a price on this tier."
          ) : (
            <>
              <b>{missingCount} active item(s) have no price on this tier</b> and will not appear on menus for companies using it:{" "}
              {[...(missing?.dishes.map((d) => d.name) ?? []), ...(missing?.options.map((o) => `${o.name} (option)`) ?? [])].join(", ")}
            </>
          )}
        </p>
        <CheckboxField label="Show only items with no price" checked={onlyMissing} onCheckedChange={setOnlyMissing} />
      </div>

      <h3 className="font-medium">Dishes</h3>
      <Table>
        <TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Dish</TableHead><TableHead>Cost</TableHead><TableHead>Price (₹)</TableHead><TableHead>Source</TableHead></TableRow></TableHeader>
        <TableBody>
          {dishes.map((d) => (
            <TableRow key={d.dishId} className={d.active ? "" : "opacity-50"}>
              <TableCell>{d.sku}</TableCell>
              <TableCell>{d.name}{!d.active && " (inactive)"}</TableCell>
              <TableCell>{formatCents(d.costCents)}</TableCell>
              <TableCell>
                {canEdit ? (
                  // key includes the price so the box refreshes after a recompute changes it
                  <CentsInput key={`${d.priceCents}`} aria-label={`Price for ${d.name}`} className="h-8 w-28" allowEmpty cents={d.priceCents} onCommit={(c) => setPrice.mutate({ kind: "dish", id: d.dishId, cents: c })} />
                ) : d.priceCents === null ? "–" : formatCents(d.priceCents)}
              </TableCell>
              <TableCell>{d.priceCents === null ? <Badge variant="outline">No price</Badge> : d.isOverride ? <Badge>Manual</Badge> : <Badge variant="secondary">Derived</Badge>}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <h3 className="font-medium">Options</h3>
      <Table>
        <TableHeader><TableRow><TableHead>Option</TableHead><TableHead>Cost</TableHead><TableHead>Price (₹)</TableHead><TableHead>Source</TableHead></TableRow></TableHeader>
        <TableBody>
          {options.map((o) => (
            <TableRow key={o.optionId} className={o.active ? "" : "opacity-50"}>
              <TableCell>{o.name}{!o.active && " (inactive)"}</TableCell>
              <TableCell>{formatCents(o.costCents)}</TableCell>
              <TableCell>
                {canEdit ? (
                  <CentsInput key={`${o.priceCents}`} aria-label={`Price for option ${o.name}`} className="h-8 w-28" allowEmpty cents={o.priceCents} onCommit={(c) => setPrice.mutate({ kind: "option", id: o.optionId, cents: c })} />
                ) : o.priceCents === null ? "–" : formatCents(o.priceCents)}
              </TableCell>
              <TableCell>{o.priceCents === null ? <Badge variant="outline">No price</Badge> : o.isOverride ? <Badge>Manual</Badge> : <Badge variant="secondary">Derived</Badge>}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function PricingPage() {
  const { can } = useMe();
  const canEdit = can(PERMISSIONS.PRICING_WRITE);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: tiers = [] } = useQuery({ queryKey: ["tiers"], queryFn: () => apiGet<Tier[]>("/tiers") });
  const selected = tiers.find((t) => t.id === selectedId) ?? tiers.find((t) => t.isDefault) ?? tiers[0];

  return (
    <div className="space-y-4">
      <PageHeader title="Pricing tiers" />
      <div className="flex flex-wrap items-center gap-2">
        {tiers.map((t) => (
          <Button key={t.id} size="sm" variant={t.id === selected?.id ? "default" : "outline"} onClick={() => { setSelectedId(t.id); setCreating(false); }}>
            {t.name}
          </Button>
        ))}
        {canEdit && <Button size="sm" variant="ghost" onClick={() => setCreating(!creating)}>{creating ? "Cancel" : "+ New tier"}</Button>}
      </div>
      {creating && <TierForm tier={null} allTiers={tiers} onDone={(saved) => { setCreating(false); setSelectedId(saved.id); }} />}
      {selected ? <TierDetail key={selected.id} tier={selected} tiers={tiers} canEdit={canEdit} /> : <p className="text-muted-foreground">No tiers yet. Create one to start pricing dishes.</p>}
    </div>
  );
}
