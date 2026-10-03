"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PERMISSIONS } from "@fernleaf/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { CentsInput } from "@/components/cents-input";
import { CheckList } from "@/components/check-list";
import { FormField } from "@/components/form-field";
import { NativeSelect } from "@/components/native-select";
import { useReference } from "@/hooks/use-reference";
import { apiGet, apiPatch, apiPost, errorMessage, fieldErrors } from "@/lib/api";
import { useMe } from "@/lib/auth";
import type { DishDetail } from "@/lib/types";
import { GroupsEditor } from "./groups-editor";

function DishForm({ dish }: { dish: DishDetail | null }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const allergens = useReference("allergens").data ?? [];
  const tags = useReference("dietary-tags").data ?? [];
  const stations = useReference("stations").data ?? [];

  const [sku, setSku] = useState(dish?.sku ?? "");
  const [name, setName] = useState(dish?.name ?? "");
  const [description, setDescription] = useState(dish?.description ?? "");
  const [imageUrl, setImageUrl] = useState(dish?.imageUrl ?? "");
  const [temperature, setTemperature] = useState<"HOT" | "COLD">(dish?.temperature ?? "HOT");
  const [cost, setCost] = useState<number | null>(dish?.costCents ?? 0);
  const [stationId, setStationId] = useState(dish?.stationId ? String(dish.stationId) : "");
  const [minQty, setMinQty] = useState(dish?.minOrderQty ? String(dish.minOrderQty) : "");
  const [allergenIds, setAllergenIds] = useState(dish?.allergens.map((a) => a.id) ?? []);
  const [tagIds, setTagIds] = useState(dish?.dietaryTags.map((t) => t.id) ?? []);
  const [errors, setErrors] = useState<Record<string, string> | undefined>();

  const save = useMutation({
    mutationFn: () => {
      const body = {
        sku, name, description, temperature,
        imageUrl: imageUrl.trim() || null,
        costCents: cost ?? 0,
        stationId: stationId ? Number(stationId) : null,
        minOrderQty: minQty.trim() ? Number(minQty) : null,
        allergenIds, dietaryTagIds: tagIds,
      };
      return dish ? apiPatch<DishDetail>(`/dishes/${dish.id}`, body) : apiPost<DishDetail>("/dishes", body);
    },
    onSuccess: (saved) => {
      setErrors(undefined);
      queryClient.invalidateQueries({ queryKey: ["dishes"] });
      queryClient.invalidateQueries({ queryKey: ["dish", saved.id] });
      toast.success("Dish saved");
      if (!dish) router.replace(`/catalogue/dishes/${saved.id}`); // new dish: go on to add its option groups
    },
    onError: (e) => { setErrors(fieldErrors(e)); toast.error(errorMessage(e)); },
  });

  const toggleActive = useMutation({
    mutationFn: () => apiPost(`/dishes/${dish!.id}/${dish!.active ? "deactivate" : "activate"}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dish", dish!.id] });
      queryClient.invalidateQueries({ queryKey: ["dishes"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">{dish ? "Dish details" : "New dish"}</CardTitle>
        {dish && <Badge variant={dish.active ? "secondary" : "outline"}>{dish.active ? "Active" : "Inactive"}</Badge>}
      </CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField name="sku" label="SKU" value={sku} onChange={(e) => setSku(e.target.value)} errors={errors} />
            <FormField name="name" label="Name" value={name} onChange={(e) => setName(e.target.value)} errors={errors} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="description">Description</label>
            <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <FormField name="imageUrl" label="Image URL" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} errors={errors} />
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="temperature">Temperature</label>
              <NativeSelect id="temperature" className="w-full" value={temperature} onChange={(e) => setTemperature(e.target.value as "HOT" | "COLD")}>
                <option value="HOT">Hot</option><option value="COLD">Cold</option>
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="costCents">Cost (₹)</label>
              <CentsInput id="costCents" cents={cost} onCommit={setCost} />
              {errors?.costCents && <p className="text-sm text-destructive">{errors.costCents}</p>}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="stationId">Kitchen station</label>
              <NativeSelect id="stationId" className="w-full" value={stationId} onChange={(e) => setStationId(e.target.value)}>
                <option value="">Unassigned</option>
                {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </NativeSelect>
              {errors?.stationId && <p className="text-sm text-destructive">{errors.stationId}</p>}
            </div>
            <FormField name="minOrderQty" label="Minimum order qty" inputMode="numeric" value={minQty} onChange={(e) => setMinQty(e.target.value)} errors={errors} />
          </div>
          <div><p className="mb-1 text-sm font-medium">Allergens</p><CheckList items={allergens} selected={allergenIds} onChange={setAllergenIds} /></div>
          <div><p className="mb-1 text-sm font-medium">Dietary tags</p><CheckList items={tags} selected={tagIds} onChange={setTagIds} /></div>
          <div className="flex gap-2">
            <Button type="submit" disabled={save.isPending}>Save dish</Button>
            {dish && (
              <Button type="button" variant="outline" onClick={() => toggleActive.mutate()}>
                {dish.active ? "Deactivate" : "Activate"}
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export default function DishPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); // in Next 16 route params arrive as a Promise
  const { can } = useMe();
  const isNew = id === "new";
  const { data: dish, error } = useQuery({
    queryKey: ["dish", Number(id)],
    queryFn: () => apiGet<DishDetail>(`/dishes/${id}`),
    enabled: !isNew,
  });

  if (!can(PERMISSIONS.CATALOGUE_WRITE)) {
    // Kitchen can read dishes; show the details read-only via the list instead of an editable form.
    return <p className="text-muted-foreground">You can view dishes in the <Link className="underline" href="/catalogue/dishes">list</Link> but not edit them.</p>;
  }
  if (error) return <p className="text-destructive">{error.message}</p>;
  if (!isNew && !dish) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <div className="max-w-4xl space-y-4">
      <Link className="text-sm underline" href="/catalogue/dishes">← All dishes</Link>
      {/* key remounts the form when a different dish loads, so its fields restart from that dish */}
      <DishForm key={dish?.id ?? "new"} dish={dish ?? null} />
      {dish && <GroupsEditor key={`g-${dish.id}-${dish.groups.length}`} dish={dish} />}
    </div>
  );
}
