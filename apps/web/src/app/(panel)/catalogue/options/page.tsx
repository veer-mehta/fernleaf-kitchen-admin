"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PERMISSIONS, formatCents } from "@fernleaf/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CentsInput } from "@/components/cents-input";
import { CheckList } from "@/components/check-list";
import { FormField } from "@/components/form-field";
import { Pagination } from "@/components/pagination";
import { useReference } from "@/hooks/use-reference";
import { apiGet, apiPatch, apiPost, errorMessage, fieldErrors } from "@/lib/api";
import { useMe } from "@/lib/auth";
import type { OptionItem, Paged } from "@/lib/types";

const PAGE_SIZE = 10;

// Create-or-edit form. `option` = null means create.
function OptionForm({ option, onDone }: { option: OptionItem | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const allergens = useReference("allergens").data ?? [];
  const tags = useReference("dietary-tags").data ?? [];
  const sizes = useReference("portion-sizes").data ?? [];
  const [name, setName] = useState(option?.name ?? "");
  const [cost, setCost] = useState<number | null>(option?.costCents ?? 0);
  const [allergenIds, setAllergenIds] = useState(option?.allergens.map((a) => a.id) ?? []);
  const [tagIds, setTagIds] = useState(option?.dietaryTags.map((t) => t.id) ?? []);
  const [sizeIds, setSizeIds] = useState(option?.portionSizes.map((p) => p.id) ?? []);
  const [errors, setErrors] = useState<Record<string, string> | undefined>();

  const save = useMutation({
    mutationFn: () => {
      const body = { name, costCents: cost ?? 0, allergenIds, dietaryTagIds: tagIds, portionSizeIds: sizeIds };
      return option ? apiPatch(`/options/${option.id}`, body) : apiPost("/options", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["options"] });
      toast.success("Option saved");
      onDone();
    },
    onError: (e) => { setErrors(fieldErrors(e)); toast.error(errorMessage(e)); },
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{option ? `Edit ${option.name}` : "New option"}</CardTitle></CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <FormField name="name" label="Name" value={name} onChange={(e) => setName(e.target.value)} errors={errors} />
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="costCents">Cost (₹)</label>
            <CentsInput id="costCents" cents={cost} onCommit={setCost} className="max-w-40" />
            {errors?.costCents && <p className="text-sm text-destructive">{errors.costCents}</p>}
          </div>
          <div><p className="mb-1 text-sm font-medium">Allergens</p><CheckList items={allergens} selected={allergenIds} onChange={setAllergenIds} /></div>
          <div><p className="mb-1 text-sm font-medium">Dietary tags</p><CheckList items={tags} selected={tagIds} onChange={setTagIds} /></div>
          <div>
            <p className="mb-1 text-sm font-medium">Sizes it can be served in</p>
            <CheckList items={sizes} selected={sizeIds} onChange={setSizeIds} />
            {errors?.portionSizeIds && <p className="text-sm text-destructive">{errors.portionSizeIds}</p>}
            <p className="text-xs text-muted-foreground">Only needed if a dish sells this option in sizes (e.g. Regular and Large).</p>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={save.isPending}>Save</Button>
            <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export default function OptionsPage() {
  const { can } = useMe();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<OptionItem | "new" | null>(null);

  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), ...(search ? { search } : {}) });
  const { data } = useQuery({ queryKey: ["options", page, search], queryFn: () => apiGet<Paged<OptionItem>>(`/options?${query}`) });

  const toggle = useMutation({
    mutationFn: (o: OptionItem) => apiPatch(`/options/${o.id}`, { active: !o.active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["options"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const canEdit = can(PERMISSIONS.CATALOGUE_WRITE);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Options</h1>
        {canEdit && <Button onClick={() => setEditing("new")}>New option</Button>}
      </div>
      {editing && <OptionForm key={editing === "new" ? "new" : editing.id} option={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      <input
        className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm"
        placeholder="Search options"
        value={search}
        onChange={(e) => { setSearch(e.target.value); setPage(1); }}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead><TableHead>Cost</TableHead><TableHead>Allergens</TableHead><TableHead>Dietary</TableHead><TableHead>Sizes</TableHead><TableHead>Status</TableHead><TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {data?.items.map((o) => (
            <TableRow key={o.id}>
              <TableCell>{o.name}</TableCell>
              <TableCell>{formatCents(o.costCents)}</TableCell>
              <TableCell>{o.allergens.map((a) => a.name).join(", ") || "–"}</TableCell>
              <TableCell>{o.dietaryTags.map((t) => t.name).join(", ") || "–"}</TableCell>
              <TableCell>{o.portionSizes.map((p) => p.name).join(", ") || "–"}</TableCell>
              <TableCell><Badge variant={o.active ? "secondary" : "outline"}>{o.active ? "Active" : "Inactive"}</Badge></TableCell>
              <TableCell className="space-x-1 text-right">
                {canEdit && <Button size="sm" variant="ghost" onClick={() => setEditing(o)}>Edit</Button>}
                {canEdit && <Button size="sm" variant="ghost" onClick={() => toggle.mutate(o)}>{o.active ? "Deactivate" : "Activate"}</Button>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />
    </div>
  );
}
