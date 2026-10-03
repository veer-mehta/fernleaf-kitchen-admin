"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Eye, EyeOff, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { PERMISSIONS } from "@fernleaf/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckboxField } from "@/components/checkbox-field";
import { IconButton } from "@/components/icon-button";
import { PageHeader } from "@/components/page-header";
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
    <div className="space-y-6">
      <PageHeader
        title="Menu categories"
        description={<>Employees see dishes through these categories. A <b>secret</b> category is not listed, but its dishes can still be ordered by staff searching for them.</>}
        actions={canEdit && (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
            <Input className="w-56" placeholder="New category name" aria-label="New category name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <Button type="submit" disabled={!newName.trim()}>Add category</Button>
          </form>
        )}
      />
      <div className="grid gap-4 xl:grid-cols-2">
        {categories.map((category, ci) => {
          const addable = (dishes?.items ?? []).filter((d) => !category.items.some((i) => i.dishId === d.id));
          return (
            <Card key={category.id} className="h-full">
              <CardHeader className="flex flex-row flex-wrap items-center gap-2 border-b">
                <CardTitle className="text-base">{category.name}</CardTitle>
                {category.isSecret && <Badge variant="secondary">Secret</Badge>}
                {!category.active && <Badge variant="outline">Inactive</Badge>}
                <span className="text-sm text-muted-foreground">{category.items.length} dish(es)</span>
                {canEdit && (
                  <div className="ml-auto flex flex-wrap items-center gap-4">
                    <CheckboxField label="Active" checked={category.active} onCheckedChange={(on) => patch.mutate({ id: category.id, body: { active: on } })} />
                    <CheckboxField label="Secret" checked={category.isSecret} onCheckedChange={(on) => patch.mutate({ id: category.id, body: { isSecret: on } })} />
                    <div className="flex items-center gap-0.5">
                      <IconButton label="Move category up" icon={ArrowUp} disabled={ci === 0} onClick={() => reorder.mutate(move(categories, ci, -1).map((c) => c.id))} />
                      <IconButton label="Move category down" icon={ArrowDown} disabled={ci === categories.length - 1} onClick={() => reorder.mutate(move(categories, ci, 1).map((c) => c.id))} />
                      <IconButton label="Delete category" icon={Trash2} className="text-destructive hover:text-destructive" onClick={() => remove.mutate(category.id)} />
                    </div>
                  </div>
                )}
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-3">
                {category.items.length === 0 ? (
                  <p className="flex-1 rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">No dishes yet. Add one below.</p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {category.items.map((item, ii) => (
                      <li key={item.dishId} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                        <span className="w-5 text-right tabular-nums text-muted-foreground">{ii + 1}</span>
                        <span className={item.active ? "font-medium" : "font-medium text-muted-foreground"}>{item.name}</span>
                        <span className="text-muted-foreground">{item.sku}</span>
                        {!item.active && <Badge variant="outline">Hidden</Badge>}
                        {canEdit && (
                          <span className="ml-auto flex items-center gap-0.5">
                            <IconButton label="Move dish up" icon={ArrowUp} disabled={ii === 0} onClick={() => saveItems.mutate({ id: category.id, items: move(category.items, ii, -1) })} />
                            <IconButton label="Move dish down" icon={ArrowDown} disabled={ii === category.items.length - 1} onClick={() => saveItems.mutate({ id: category.id, items: move(category.items, ii, 1) })} />
                            <IconButton
                              label={item.active ? "Hide dish" : "Show dish"}
                              icon={item.active ? EyeOff : Eye}
                              onClick={() => saveItems.mutate({ id: category.id, items: category.items.map((x, k) => (k === ii ? { ...x, active: !x.active } : x)) })}
                            />
                            <IconButton label="Remove from category" icon={X} onClick={() => saveItems.mutate({ id: category.id, items: category.items.filter((_, k) => k !== ii) })} />
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {canEdit && (
                  <NativeSelect
                    className="mt-auto w-full max-w-sm"
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
    </div>
  );
}
