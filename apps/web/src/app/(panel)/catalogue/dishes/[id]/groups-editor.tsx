"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/native-select";
import { apiGet, apiPut, errorMessage, fieldErrors } from "@/lib/api";
import type { DishDetail, OptionItem, Paged } from "@/lib/types";

interface GroupDraft {
  name: string;
  required: boolean;
  usesPortions: boolean;
  optionIds: number[];
}

// Moves item i by `delta` places in a copy of the array (used by the up/down buttons).
function move<T>(list: T[], i: number, delta: number): T[] {
  const j = i + delta;
  if (j < 0 || j >= list.length) return list;
  const copy = [...list];
  [copy[i], copy[j]] = [copy[j], copy[i]];
  return copy;
}

export function GroupsEditor({ dish }: { dish: DishDetail }) {
  const queryClient = useQueryClient();
  const [groups, setGroups] = useState<GroupDraft[]>(
    dish.groups.map((g) => ({ name: g.name, required: g.required, usesPortions: g.usesPortions, optionIds: g.options.map((o) => o.id) })),
  );
  const [errors, setErrors] = useState<Record<string, string> | undefined>();

  // Options available to pick (the first 100 active ones is plenty for this catalogue).
  const { data: optionPage } = useQuery({
    queryKey: ["options", "all-active"],
    queryFn: () => apiGet<Paged<OptionItem>>("/options?pageSize=100&active=true"),
  });
  const nameById = new Map<number, string>();
  dish.groups.forEach((g) => g.options.forEach((o) => nameById.set(o.id, o.name))); // includes inactive ones already used
  optionPage?.items.forEach((o) => nameById.set(o.id, o.name));

  const update = (i: number, patch: Partial<GroupDraft>) => setGroups(groups.map((g, k) => (k === i ? { ...g, ...patch } : g)));

  const save = useMutation({
    mutationFn: () => apiPut(`/dishes/${dish.id}/groups`, { groups }),
    onSuccess: () => {
      setErrors(undefined);
      queryClient.invalidateQueries({ queryKey: ["dish", dish.id] });
      toast.success("Option groups saved");
    },
    onError: (e) => { setErrors(fieldErrors(e)); toast.error(errorMessage(e)); },
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Option groups</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Choices the employee makes for this dish, e.g. “Choose your protein”. One option per group. The order here is the order shown.
        </p>
        {groups.map((group, i) => {
          const available = (optionPage?.items ?? []).filter((o) => !group.optionIds.includes(o.id));
          return (
            <div key={i} className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Input className="h-8 max-w-xs" placeholder="Group name" value={group.name} onChange={(e) => update(i, { name: e.target.value })} />
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={group.required} onChange={(e) => update(i, { required: e.target.checked })} /> Required
                </label>
                <Button size="sm" variant="ghost" onClick={() => setGroups(move(groups, i, -1))}>↑</Button>
                <Button size="sm" variant="ghost" onClick={() => setGroups(move(groups, i, 1))}>↓</Button>
                <Button size="sm" variant="ghost" onClick={() => setGroups(groups.filter((_, k) => k !== i))}>Remove group</Button>
              </div>
              <ol className="list-decimal space-y-1 pl-6 text-sm">
                {group.optionIds.map((id, j) => (
                  <li key={id}>
                    <span className="mr-2">{nameById.get(id) ?? `Option ${id}`}</span>
                    <Button size="sm" variant="ghost" onClick={() => update(i, { optionIds: move(group.optionIds, j, -1) })}>↑</Button>
                    <Button size="sm" variant="ghost" onClick={() => update(i, { optionIds: move(group.optionIds, j, 1) })}>↓</Button>
                    <Button size="sm" variant="ghost" onClick={() => update(i, { optionIds: group.optionIds.filter((o) => o !== id) })}>✕</Button>
                  </li>
                ))}
              </ol>
              <NativeSelect
                value=""
                aria-label={`Add option to group ${i + 1}`}
                onChange={(e) => e.target.value && update(i, { optionIds: [...group.optionIds, Number(e.target.value)] })}
              >
                <option value="">Add an option…</option>
                {available.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </NativeSelect>
              {errors?.[`groups.${i}.optionIds`] && <p className="text-sm text-destructive">{errors[`groups.${i}.optionIds`]}</p>}
              {errors?.[`groups.${i}.name`] && <p className="text-sm text-destructive">{errors[`groups.${i}.name`]}</p>}
            </div>
          );
        })}
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setGroups([...groups, { name: "", required: false, usesPortions: false, optionIds: [] }])}>Add group</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Save groups</Button>
        </div>
      </CardContent>
    </Card>
  );
}
