"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { IconButton } from "@/components/icon-button";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useReference, type ReferenceKind } from "@/hooks/use-reference";
import { useMe } from "@/lib/auth";
import { apiDelete, apiPatch, apiPost, errorMessage } from "@/lib/api";
import { PERMISSIONS } from "@fernleaf/shared";

const LISTS: { kind: ReferenceKind; title: string }[] = [
  { kind: "allergens", title: "Allergens" },
  { kind: "dietary-tags", title: "Dietary tags" },
  { kind: "stations", title: "Kitchen stations" },
  { kind: "portion-sizes", title: "Portion sizes" },
];

function ReferenceList({ kind, title, canEdit }: { kind: ReferenceKind; title: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const { data = [] } = useReference(kind);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);

  // After any change, refetch this list (every screen using it updates too).
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["reference", kind] });
  const onError = (e: unknown) => toast.error(errorMessage(e));

  const add = useMutation({
    mutationFn: () => apiPost(`/reference/${kind}`, { name: newName }),
    onSuccess: () => { setNewName(""); refresh(); },
    onError,
  });
  const rename = useMutation({
    mutationFn: (v: { id: number; name: string }) => apiPatch(`/reference/${kind}/${v.id}`, { name: v.name }),
    onSuccess: () => { setEditing(null); refresh(); },
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: number) => apiDelete(`/reference/${kind}/${id}`),
    onSuccess: refresh,
    onError,
  });

  return (
    <Card className="h-full">
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <ul className="flex-1 space-y-1">
          {data.map((item) => (
            <li key={item.id} className="flex items-center gap-2 text-sm">
              {editing?.id === item.id ? (
                <>
                  <Input value={editing.name} onChange={(e) => setEditing({ id: item.id, name: e.target.value })} />
                  <IconButton label="Save name" icon={Check} size="icon" variant="default" onClick={() => rename.mutate(editing)} />
                  <IconButton label="Cancel" icon={X} size="icon" variant="outline" onClick={() => setEditing(null)} />
                </>
              ) : (
                <>
                  <span className="flex-1">{item.name}</span>
                  {canEdit && (
                    <>
                      <IconButton label="Rename" icon={Pencil} onClick={() => setEditing(item)} />
                      <IconButton label="Delete" icon={Trash2} className="text-destructive hover:text-destructive" onClick={() => remove.mutate(item.id)} />
                    </>
                  )}
                </>
              )}
            </li>
          ))}
          {data.length === 0 && <li className="text-sm text-muted-foreground">Nothing here yet.</li>}
        </ul>
        {canEdit && (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
            <Input placeholder={`New ${title.toLowerCase()} name`} value={newName} onChange={(e) => setNewName(e.target.value)} />
            <IconButton type="submit" label="Add" icon={Plus} size="icon" variant="default" disabled={!newName.trim()} />
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export default function ReferencePage() {
  const { can } = useMe();
  return (
    <div className="space-y-6">
      <PageHeader title="Reference lists" description={<>Values used by dishes and options. A value in use cannot be deleted.</>} />
      <div className="grid gap-4 md:grid-cols-2">
        {LISTS.map((l) => (
          <ReferenceList key={l.kind} {...l} canEdit={can(PERMISSIONS.CATALOGUE_WRITE)} />
        ))}
      </div>
    </div>
  );
}
