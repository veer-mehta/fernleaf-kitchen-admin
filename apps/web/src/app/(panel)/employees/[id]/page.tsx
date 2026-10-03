"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PERMISSIONS } from "@fernleaf/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckList } from "@/components/check-list";
import { FormField } from "@/components/form-field";
import { NativeSelect } from "@/components/native-select";
import { useReference } from "@/hooks/use-reference";
import { apiGet, apiPatch, apiPost, errorMessage, fieldErrors } from "@/lib/api";
import { useMe } from "@/lib/auth";
import type { CompanyListItem, EmployeeRow, Paged } from "@/lib/types";

function EmployeeForm({ employee }: { employee: EmployeeRow | null }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const allergens = useReference("allergens").data ?? [];
  const tags = useReference("dietary-tags").data ?? [];
  const { data: companies } = useQuery({ queryKey: ["companies", "all"], queryFn: () => apiGet<Paged<CompanyListItem>>("/companies?pageSize=100") });

  const [companyId, setCompanyId] = useState(employee ? String(employee.company.id) : "");
  const [name, setName] = useState(employee?.name ?? "");
  const [email, setEmail] = useState(employee?.email ?? "");
  const [active, setActive] = useState(employee?.active ?? true);
  const [flags, setFlags] = useState({
    canChooseAddress: employee?.canChooseAddress ?? false,
    canChangeTime: employee?.canChangeTime ?? false,
    canChangePackaging: employee?.canChangePackaging ?? false,
  });
  const [allergenIds, setAllergenIds] = useState(employee?.allergens.map((a) => a.id) ?? []);
  const [tagIds, setTagIds] = useState(employee?.dietaryTags.map((t) => t.id) ?? []);
  const [errors, setErrors] = useState<Record<string, string> | undefined>();

  const selectedCompany = companies?.items.find((c) => String(c.id) === companyId);

  const save = useMutation({
    mutationFn: () => {
      const body = { companyId: Number(companyId), name, email, active, ...flags, allergenIds, dietaryTagIds: tagIds };
      return employee ? apiPatch<EmployeeRow>(`/employees/${employee.id}`, body) : apiPost<EmployeeRow>("/employees", body);
    },
    onSuccess: (saved) => {
      setErrors(undefined);
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["employee", saved.id] });
      toast.success("Employee saved");
      if (!employee) router.replace(`/employees/${saved.id}`);
    },
    onError: (e) => { setErrors(fieldErrors(e)); toast.error(errorMessage(e)); },
  });

  return (
    <Card className="max-w-3xl">
      <CardHeader><CardTitle className="text-base">{employee ? "Employee details" : "New employee"}</CardTitle></CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="company">Company</label>
            <NativeSelect id="company" className="w-full" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">Choose a company…</option>
              {companies?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </NativeSelect>
            {errors?.companyId && <p className="text-sm text-destructive">{errors.companyId}</p>}
            {employee && String(employee.company.id) !== companyId && companyId && (
              <p className="text-sm text-amber-700">Moving this employee changes their menu, prices and calendar from now on. Their existing orders stay with {employee.company.name}. Remember to use an email at the new company’s domain.</p>
            )}
            {selectedCompany && <p className="text-xs text-muted-foreground">Email domains: {selectedCompany.domains.join(", ")}</p>}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField name="name" label="Name" value={name} onChange={(e) => setName(e.target.value)} errors={errors} />
            <FormField name="email" label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} errors={errors} />
          </div>
          <div>
            <p className="mb-1 text-sm font-medium">This employee may change…</p>
            <div className="flex flex-wrap gap-4 text-sm">
              {([["canChooseAddress", "their delivery address"], ["canChangeTime", "the delivery time"], ["canChangePackaging", "the packaging"]] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-1.5">
                  <input type="checkbox" checked={flags[key]} onChange={(e) => setFlags({ ...flags, [key]: e.target.checked })} /> {label}
                </label>
              ))}
            </div>
          </div>
          <div><p className="mb-1 text-sm font-medium">Allergies</p><CheckList items={allergens} selected={allergenIds} onChange={setAllergenIds} /></div>
          <div><p className="mb-1 text-sm font-medium">Dietary preferences</p><CheckList items={tags} selected={tagIds} onChange={setTagIds} /></div>
          <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active (can have orders placed)</label>
          <Button type="submit" disabled={save.isPending || !companyId}>Save employee</Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useMe();
  const isNew = id === "new";
  const { data: employee, error } = useQuery({ queryKey: ["employee", Number(id)], queryFn: () => apiGet<EmployeeRow>(`/employees/${id}`), enabled: !isNew });

  if (!can(PERMISSIONS.EMPLOYEES_WRITE)) return <p className="text-muted-foreground">You can view employees in the <Link className="underline" href="/employees">list</Link> but not edit them.</p>;
  if (error) return <p className="text-destructive">{error.message}</p>;
  if (!isNew && !employee) return <p className="text-muted-foreground">Loading…</p>;
  return (
    <div className="space-y-4">
      <Link className="text-sm underline" href="/employees">← All employees</Link>
      <EmployeeForm key={employee?.id ?? "new"} employee={employee ?? null} />
    </div>
  );
}
