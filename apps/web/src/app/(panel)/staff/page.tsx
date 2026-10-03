"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PERMISSIONS } from "@fernleaf/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormField } from "@/components/form-field";
import { NativeSelect } from "@/components/native-select";
import { apiGet, apiPatch, apiPost, errorMessage, fieldErrors } from "@/lib/api";
import { useMe } from "@/lib/auth";
import type { Named, StaffRow } from "@/lib/types";

function NewStaff({ roles }: { roles: Named[] }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", email: "", password: "", roleId: "" });
  const [errors, setErrors] = useState<Record<string, string> | undefined>();
  const create = useMutation({
    mutationFn: () => apiPost("/staff", { ...form, roleId: Number(form.roleId) }),
    onSuccess: () => { toast.success("Staff account created"); setForm({ name: "", email: "", password: "", roleId: "" }); setErrors(undefined); queryClient.invalidateQueries({ queryKey: ["staff"] }); },
    onError: (e) => { setErrors(fieldErrors(e)); toast.error(errorMessage(e)); },
  });
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">New staff account</CardTitle></CardHeader>
      <CardContent>
        <form className="grid gap-3 md:grid-cols-5" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <FormField name="name" label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} errors={errors} />
          <FormField name="email" label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} errors={errors} />
          <FormField name="password" label="Password (8+ characters)" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} errors={errors} />
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="roleId">Role</label>
            <NativeSelect id="roleId" className="w-full" value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
              <option value="">Choose…</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </NativeSelect>
            {errors?.roleId && <p className="text-sm text-destructive">{errors.roleId}</p>}
          </div>
          <Button type="submit" className="self-end" disabled={create.isPending || !form.roleId}>Create</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function StaffLine({ person, roles, canEdit, isMe }: { person: StaffRow; roles: Named[]; canEdit: boolean; isMe: boolean }) {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const update = useMutation({
    mutationFn: (body: object) => apiPatch(`/staff/${person.id}`, body),
    onSuccess: () => { setPassword(""); queryClient.invalidateQueries({ queryKey: ["staff"] }); },
    onError: (e) => { toast.error(errorMessage(e)); queryClient.invalidateQueries({ queryKey: ["staff"] }); },
  });
  return (
    <TableRow>
      <TableCell>{person.name}{isMe && <span className="text-muted-foreground"> (you)</span>}</TableCell>
      <TableCell>{person.email}</TableCell>
      <TableCell>
        {canEdit ? (
          <NativeSelect aria-label={`Role of ${person.name}`} value={person.role.id} onChange={(e) => update.mutate({ roleId: Number(e.target.value) })}>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </NativeSelect>
        ) : person.role.name}
      </TableCell>
      <TableCell><Badge variant={person.active ? "secondary" : "outline"}>{person.active ? "Active" : "Inactive"}</Badge></TableCell>
      <TableCell className="space-x-1 text-right">
        {canEdit && (
          <>
            <Button size="sm" variant="ghost" disabled={isMe && person.active} onClick={() => update.mutate({ active: !person.active })}>{person.active ? "Deactivate" : "Activate"}</Button>
            <Input className="inline-block h-8 w-36" type="password" placeholder="New password" aria-label={`New password for ${person.name}`} value={password} onChange={(e) => setPassword(e.target.value)} />
            <Button size="sm" variant="outline" disabled={password.length < 8} onClick={() => update.mutate({ password })}>Reset</Button>
          </>
        )}
      </TableCell>
    </TableRow>
  );
}

export default function StaffPage() {
  const { me, can } = useMe();
  const canEdit = can(PERMISSIONS.STAFF_WRITE);
  const { data: staff, error } = useQuery({ queryKey: ["staff"], queryFn: () => apiGet<StaffRow[]>("/staff") });
  const { data: roles = [] } = useQuery({ queryKey: ["roles"], queryFn: () => apiGet<Named[]>("/roles") });

  if (error) return <p className="text-destructive">{error.message}</p>;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Staff</h1>
      <p className="text-sm text-muted-foreground">Each person has exactly one role. What a role may do is set in the database (roles and permissions), not in code.</p>
      {canEdit && <NewStaff roles={roles} />}
      <Table>
        <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
        <TableBody>{staff?.map((s) => <StaffLine key={s.id} person={s} roles={roles} canEdit={canEdit} isMe={s.id === me?.id} />)}</TableBody>
      </Table>
    </div>
  );
}
