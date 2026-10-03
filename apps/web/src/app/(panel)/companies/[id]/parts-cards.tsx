"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CheckList } from "@/components/check-list";
import { FormField } from "@/components/form-field";
import { apiDelete, apiGet, apiPost, apiPut, errorMessage, fieldErrors } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { CategoryRow, CompanyDetail, DishListItem, Paged } from "@/lib/types";

// Each card edits one kind of sub-record of a company and refreshes the company afterwards.
function useCompanyRefresh(companyId: number) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["company", companyId] });
}
const onError = (e: unknown) => toast.error(errorMessage(e));

export function DomainsCard({ company, canEdit }: { company: CompanyDetail; canEdit: boolean }) {
  const refresh = useCompanyRefresh(company.id);
  const [domain, setDomain] = useState("");
  const [errors, setErrors] = useState<Record<string, string> | undefined>();
  const add = useMutation({
    mutationFn: () => apiPost(`/companies/${company.id}/domains`, { domain }),
    onSuccess: () => { setDomain(""); setErrors(undefined); refresh(); },
    onError: (e) => { setErrors(fieldErrors(e)); onError(e); },
  });
  const remove = useMutation({ mutationFn: (id: number) => apiDelete(`/companies/${company.id}/domains/${id}`), onSuccess: refresh, onError });
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Email domains</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">Employees must have an email at one of these. Two companies cannot share a domain, and public ones (gmail.com…) are not allowed.</p>
        <ul className="space-y-1 text-sm">
          {company.domains.map((d) => (
            <li key={d.id} className="flex items-center gap-2">
              <span className="flex-1">{d.domain}</span>
              {canEdit && <Button size="sm" variant="ghost" onClick={() => remove.mutate(d.id)}>Remove</Button>}
            </li>
          ))}
        </ul>
        {canEdit && (
          <form className="flex max-w-sm gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
            <div className="flex-1"><FormField name="domain" label="" placeholder="acme.com" aria-label="New domain" value={domain} onChange={(e) => setDomain(e.target.value)} errors={errors} /></div>
            <Button type="submit" className="self-start" disabled={!domain.trim()}>Add</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export function AddressesCard({ company, canEdit }: { company: CompanyDetail; canEdit: boolean }) {
  const refresh = useCompanyRefresh(company.id);
  const empty = { label: "", line1: "", city: "", postalCode: "" };
  const [draft, setDraft] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string> | undefined>();
  const add = useMutation({
    mutationFn: () => apiPost(`/companies/${company.id}/addresses`, draft),
    onSuccess: () => { setDraft(empty); setErrors(undefined); refresh(); },
    onError: (e) => { setErrors(fieldErrors(e)); onError(e); },
  });
  const remove = useMutation({ mutationFn: (id: number) => apiDelete(`/companies/${company.id}/addresses/${id}`), onSuccess: refresh, onError });
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Delivery addresses</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-1 text-sm">
          {company.addresses.map((a, i) => (
            <li key={a.id} className="flex items-center gap-2">
              <span className="flex-1"><b>{a.label}</b>{i === 0 && " (default)"} · {a.line1}, {a.city} {a.postalCode}</span>
              {canEdit && <Button size="sm" variant="ghost" onClick={() => remove.mutate(a.id)}>Remove</Button>}
            </li>
          ))}
        </ul>
        {canEdit && (
          <form className="grid gap-2 md:grid-cols-5" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
            <FormField name="label" label="Name" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} errors={errors} />
            <FormField name="line1" label="Address line" value={draft.line1} onChange={(e) => setDraft({ ...draft, line1: e.target.value })} errors={errors} />
            <FormField name="city" label="City" value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} errors={errors} />
            <FormField name="postalCode" label="Postal code" value={draft.postalCode} onChange={(e) => setDraft({ ...draft, postalCode: e.target.value })} errors={errors} />
            <Button type="submit" className="self-end">Add address</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export function HolidaysCard({ company, canEdit }: { company: CompanyDetail; canEdit: boolean }) {
  const refresh = useCompanyRefresh(company.id);
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<Record<string, string> | undefined>();
  const add = useMutation({
    mutationFn: () => apiPost(`/companies/${company.id}/holidays`, { date, name }),
    onSuccess: () => { setDate(""); setName(""); setErrors(undefined); refresh(); },
    onError: (e) => { setErrors(fieldErrors(e)); onError(e); },
  });
  const remove = useMutation({ mutationFn: (id: number) => apiDelete(`/companies/${company.id}/holidays/${id}`), onSuccess: refresh, onError });
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Company holidays</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">The company cannot receive deliveries on these days. They do not move the order cut-off, which follows the kitchen calendar.</p>
        <ul className="space-y-1 text-sm">
          {company.holidays.map((h) => (
            <li key={h.id} className="flex items-center gap-2">
              <span className="flex-1">{formatDate(h.date)} {h.name && `· ${h.name}`}</span>
              {canEdit && <Button size="sm" variant="ghost" onClick={() => remove.mutate(h.id)}>Remove</Button>}
            </li>
          ))}
          {company.holidays.length === 0 && <li className="text-muted-foreground">None.</li>}
        </ul>
        {canEdit && (
          <form className="flex flex-wrap items-start gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
            <div className="w-44"><FormField name="date" label="" type="date" aria-label="Holiday date" value={date} onChange={(e) => setDate(e.target.value)} errors={errors} /></div>
            <Input className="w-56" placeholder="Name (optional)" aria-label="Holiday name" value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" disabled={!date}>Add holiday</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export function HiddenMenuCard({ company, canEdit }: { company: CompanyDetail; canEdit: boolean }) {
  const refresh = useCompanyRefresh(company.id);
  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: () => apiGet<CategoryRow[]>("/categories"), retry: false });
  const { data: dishes } = useQuery({ queryKey: ["dishes", "all-active"], queryFn: () => apiGet<Paged<DishListItem>>("/dishes?pageSize=100&active=true"), retry: false });
  const [categoryIds, setCategoryIds] = useState(company.hiddenCategoryIds);
  const [dishIds, setDishIds] = useState(company.hiddenDishIds);
  const save = useMutation({
    mutationFn: () => apiPut(`/companies/${company.id}/hidden`, { categoryIds, dishIds }),
    onSuccess: () => { toast.success("Hidden items saved"); refresh(); },
    onError,
  });
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Hidden from this company’s menu</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">Tick what employees of this company must NOT see. Hiding a category hides its dishes for this company.</p>
        <div><p className="mb-1 text-sm font-medium">Categories</p><CheckList items={categories.map((c) => ({ id: c.id, name: c.name }))} selected={categoryIds} onChange={setCategoryIds} /></div>
        <div><p className="mb-1 text-sm font-medium">Dishes</p><CheckList items={(dishes?.items ?? []).map((d) => ({ id: d.id, name: d.name }))} selected={dishIds} onChange={setDishIds} /></div>
        {canEdit && <Button onClick={() => save.mutate()} disabled={save.isPending}>Save hidden items</Button>}
      </CardContent>
    </Card>
  );
}
