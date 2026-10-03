"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatScaled, parseDecimalToInt } from "@fernleaf/shared";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/form-field";
import { NativeSelect } from "@/components/native-select";
import { apiPatch, apiPost, errorMessage, fieldErrors } from "@/lib/api";
import type { Derivation, Tier } from "@/lib/types";

// Create (tier = null) or edit a tier's name and pricing rule.
// People type "2.4" and "15"; the API receives integers (2400 and 1500) so no decimals are stored.
export function TierForm({ tier, allTiers, onDone }: { tier: Tier | null; allTiers: Tier[]; onDone: (saved: Tier) => void }) {
  const queryClient = useQueryClient();
  const d = tier?.derivation;
  const [name, setName] = useState(tier?.name ?? "");
  const [type, setType] = useState<Derivation["type"]>(d?.type ?? "NONE");
  const [multiplier, setMultiplier] = useState(d?.type === "COST_MULTIPLE" ? formatScaled(d.multiplierMilli, 3) : "");
  const [percent, setPercent] = useState(d?.type === "TIER_PERCENT" ? formatScaled(d.percentBp, 2) : "");
  const [baseTierId, setBaseTierId] = useState(d?.type === "TIER_PERCENT" ? String(d.baseTierId) : "");
  const [errors, setErrors] = useState<Record<string, string> | undefined>();

  function buildDerivation(): Derivation | null {
    if (type === "NONE") return { type };
    if (type === "COST_MULTIPLE") {
      const m = parseDecimalToInt(multiplier, 3);
      if (m === null || m <= 0) { setErrors({ "derivation.multiplierMilli": "Enter a multiplier like 2.4" }); return null; }
      return { type, multiplierMilli: m };
    }
    const p = parseDecimalToInt(percent, 2);
    if (p === null) { setErrors({ "derivation.percentBp": "Enter a percentage like 15 (or -10 for a discount)" }); return null; }
    if (!baseTierId) { setErrors({ "derivation.baseTierId": "Choose the tier to base this on" }); return null; }
    return { type, percentBp: p, baseTierId: Number(baseTierId) };
  }

  const save = useMutation({
    mutationFn: (derivation: Derivation) =>
      tier ? apiPatch<Tier>(`/tiers/${tier.id}`, { name, derivation }) : apiPost<Tier>("/tiers", { name, derivation }),
    onSuccess: (saved) => {
      setErrors(undefined);
      queryClient.invalidateQueries({ queryKey: ["tiers"] });
      queryClient.invalidateQueries({ queryKey: ["grid"] }); // a rule change reprices tiers
      queryClient.invalidateQueries({ queryKey: ["missing"] });
      toast.success("Tier saved");
      onDone(saved);
    },
    onError: (e) => { setErrors(fieldErrors(e)); toast.error(errorMessage(e)); },
  });

  const baseChoices = allTiers.filter((t) => t.id !== tier?.id);

  return (
    <form
      className="space-y-3 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const derivation = buildDerivation();
        if (derivation) save.mutate(derivation);
      }}
    >
      <FormField name="name" label="Tier name" value={name} onChange={(e) => setName(e.target.value)} errors={errors} />
      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="derivation">How are prices set?</label>
        <NativeSelect id="derivation" className="w-full" value={type} onChange={(e) => setType(e.target.value as Derivation["type"])}>
          <option value="NONE">Typed in by hand</option>
          <option value="COST_MULTIPLE">Cost × a multiplier</option>
          <option value="TIER_PERCENT" disabled={baseChoices.length === 0}>Another tier’s price + a percentage</option>
        </NativeSelect>
      </div>
      {type === "COST_MULTIPLE" && (
        <FormField name="derivation.multiplierMilli" label="Multiplier (e.g. 2.4)" value={multiplier} onChange={(e) => setMultiplier(e.target.value)} errors={errors} />
      )}
      {type === "TIER_PERCENT" && (
        <>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="baseTier">Based on</label>
            <NativeSelect id="baseTier" className="w-full" value={baseTierId} onChange={(e) => setBaseTierId(e.target.value)}>
              <option value="">Choose a tier…</option>
              {baseChoices.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </NativeSelect>
            {errors?.["derivation.baseTierId"] && <p className="text-sm text-destructive">{errors["derivation.baseTierId"]}</p>}
          </div>
          <FormField name="derivation.percentBp" label="Percentage (e.g. 15, or -10 to discount)" value={percent} onChange={(e) => setPercent(e.target.value)} errors={errors} />
        </>
      )}
      {type !== "NONE" && (
        <p className="text-xs text-muted-foreground">Derived prices round up to the next 5 paise. Prices you type into the grid stay as they are.</p>
      )}
      <Button type="submit" disabled={save.isPending}>{tier ? "Save tier" : "Create tier"}</Button>
    </form>
  );
}
