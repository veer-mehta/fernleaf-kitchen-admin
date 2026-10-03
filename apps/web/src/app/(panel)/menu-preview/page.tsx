"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DishCard } from "@/components/dish-card";
import { NativeSelect } from "@/components/native-select";
import { apiGet } from "@/lib/api";
import type { CompanyListItem, EmployeeRow, Menu, Paged } from "@/lib/types";

// Staff pick a company and an employee and see exactly the menu that employee would get when ordering.
export default function MenuPreviewPage() {
  const [companyId, setCompanyId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const { data: companies } = useQuery({ queryKey: ["companies", "all"], queryFn: () => apiGet<Paged<CompanyListItem>>("/companies?pageSize=100") });
  const { data: employees } = useQuery({
    queryKey: ["employees", "company", Number(companyId)],
    queryFn: () => apiGet<Paged<EmployeeRow>>(`/employees?companyId=${companyId}&pageSize=100`),
    enabled: !!companyId,
  });
  const { data: menu, error } = useQuery({
    queryKey: ["menu", Number(employeeId)],
    queryFn: () => apiGet<Menu>(`/employees/${employeeId}/menu`),
    enabled: !!employeeId,
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Menu preview" description={<>The menu exactly as this employee sees it: their company’s price tier, hidden items removed, dishes without a price left out.</>} />
      <div className="flex flex-wrap gap-2">
        <NativeSelect aria-label="Company" value={companyId} onChange={(e) => { setCompanyId(e.target.value); setEmployeeId(""); }}>
          <option value="">Choose a company…</option>
          {companies?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="Employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} disabled={!companyId}>
          <option value="">Choose an employee…</option>
          {employees?.items.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </NativeSelect>
      </div>
      {error && <p className="text-destructive">{error.message}</p>}
      {menu && (
        <div className="space-y-4">
          <p className="text-sm">Price tier: <Badge variant="secondary">{menu.tierId ? `#${menu.tierId}` : "none"}</Badge></p>
          {menu.categories.length === 0 && <p className="text-muted-foreground">Nothing is available on this employee’s menu.</p>}
          {menu.categories.map((c) => (
            <Card key={c.id}>
              <CardHeader><CardTitle className="text-base">{c.name}</CardTitle></CardHeader>
              <CardContent className="grid gap-2 md:grid-cols-2">{c.dishes.map((d) => <DishCard key={d.dishId} dish={d} />)}</CardContent>
            </Card>
          ))}
          {menu.secretDishes.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Secret categories <span className="text-sm font-normal text-muted-foreground">(not listed to the employee; staff can still order them)</span></CardTitle></CardHeader>
              <CardContent className="grid gap-2 md:grid-cols-2">{menu.secretDishes.map((d) => <DishCard key={d.dishId} dish={d} />)}</CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
