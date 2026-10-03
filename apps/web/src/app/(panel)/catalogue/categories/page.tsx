"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PERMISSIONS } from "@fernleaf/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/native-select";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, errorMessage } from "@/lib/api";
import { useMe } from "@/lib/auth";
import type { CategoryItemRow, CategoryRow, DishListItem, Paged } from "@/lib/types";

function move<T>(list: T[], i: number, delta: number): T[] {
  const j = i + delta;
  if (j < 0 || j >= list.length) return list;
  const copy = [...list];
  [copy[i], copy[j]] = [copy[j], copy[i]];
  return copy;
}

export default function CategoriesPage() {
  const { can } = useMe();
  const canEdit = can(PERMISSIONS.CATALOGUE_WRITE);
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");

  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: () => apiGet<CategoryRow[]>("/categories") });
  const { data: dishes } = useQuery({
    queryKey: ["dishes", "all-active"],
    queryFn: () => apiGet<Paged<DishListItem>>("/dishes?pageSize=100&active=true"),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["categories"] });
  const onError = (e: unknown) => toast.error(errorMessage(e));

  const create = useMutation({ mutationFn: () => apiPost("/categories", { name: newName }), onSuccess: () => { setNewName(""); refresh(); }, onError });
  const patch = useMutation({ mutationFn: (v: { id: number; body: object }) => apiPatch(`/categories/${v.id}`, v.body), onSuccess: refresh, onError });
  const remove = useMutation({ mutationFn: (id: number) => apiDelete(`/categories/${id}`), onSuccess: refresh, onError });
  const reorder = useMutation({ mutationFn: (ids: number[]) => apiPut("/categories/order", { ids }), onSuccess: refresh, onError });
  const saveItems = useMutation({
    mutationFn: (v: { id: number; items: CategoryItemRow[] }) =>
      apiPut(`/categories/${v.id}/items`, { items: v.items.map((i) => ({ dishId: i.dishId, active: i.active })) }),
    onSuccess: refresh,
    onError,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Menu categories</h1>
      <p className="text-sm text-muted-foreground">
        Employees see dishes through these categories. A <b>secret</b> category is not listed, but its dishes can still be ordered by staff searching for them.
      </p>
      {canEdit && (
        <form className="flex max-w-sm gap-2" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <Input placeholder="New category name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Button type="submit" disabled={!newName.trim()}>Add</Button>
        </form>
      )}
      {categories.map((category, ci) => {
        const addable = (dishes?.items ?? []).filter((d) => !category.items.some((i) => i.dishId === d.id));
        return (
          <Card key={category.id}>
            <CardHeader className="flex-row flex-wrap items-center gap-2">
              <CardTitle className="text-base">{category.name}</CardTitle>
              {category.isSecret && <Badge variant="secondary">Secret</Badge>}
              {!category.active && <Badge variant="outline">Inactive</Badge>}
              {canEdit && (
                <div className="ml-auto flex flex-wrap items-center gap-1">
                  <label className="flex items-center gap-1 text-sm">
                    <input type="checkbox" checked={category.active} onChange={(e) => patch.mutate({ id: category.id, body: { active: e.target.checked } })} /> Active
                  </label>
                  <label className="flex items-center gap-1 text-sm">
                    <input type="checkbox" checked={category.isSecret} onChange={(e) => patch.mutate({ id: category.id, body: { isSecret: e.target.checked } })} /> Secret
                  </label>
                  <Button size="sm" variant="ghost" onClick={() => reorder.mutate(move(categories, ci, -1).map((c) => c.id))}>↑</Button>
                  <Button size="sm" variant="ghost" onClick={() => reorder.mutate(move(categories, ci, 1).map((c) => c.id))}>↓</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove.mutate(category.id)}>Delete</Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-2">
              <ol className="list-decimal space-y-1 pl-6 text-sm">
                {category.items.map((item, ii) => (
                  <li key={item.dishId} className={item.active ? "" : "text-muted-foreground line-through"}>
                    {item.name} <span className="text-muted-foreground">({item.sku})</span>
                    {canEdit && (
                      <span className="ml-2 inline-flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => saveItems.mutate({ id: category.id, items: move(category.items, ii, -1) })}>↑</Button>
                        <Button size="sm" variant="ghost" onClick={() => saveItems.mutate({ id: category.id, items: move(category.items, ii, 1) })}>↓</Button>
                        <Button size="sm" variant="ghost" onClick={() => saveItems.mutate({ id: category.id, items: category.items.map((x, k) => (k === ii ? { ...x, active: !x.active } : x)) })}>
                          {item.active ? "Hide" : "Show"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => saveItems.mutate({ id: category.id, items: category.items.filter((_, k) => k !== ii) })}>✕</Button>
                      </span>
                    )}
                  </li>
                ))}
                {category.items.length === 0 && <li className="list-none text-muted-foreground">No dishes yet.</li>}
              </ol>
              {canEdit && (
                <NativeSelect
                  value=""
                  aria-label={`Add dish to ${category.name}`}
                  onChange={(e) => {
                    const dish = addable.find((d) => d.id === Number(e.target.value));
                    if (dish) saveItems.mutate({ id: category.id, items: [...category.items, { dishId: dish.id, sku: dish.sku, name: dish.name, active: true }] });
                  }}
                >
                  <option value="">Add a dish…</option>
                  {addable.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.sku})</option>)}
                </NativeSelect>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
