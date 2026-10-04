"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PERMISSIONS } from "@fernleaf/shared";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/native-select";
import { EmployeeImport } from "@/components/employee-import";
import { Pagination } from "@/components/pagination";
import { usePageSize } from "@/lib/use-page-size";
import { apiGet } from "@/lib/api";
import { useMe } from "@/lib/auth";
import type { CompanyListItem, EmployeeRow, Paged } from "@/lib/types";


export default function EmployeesPage() {
  const { can } = useMe();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("employees");
  const [search, setSearch] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [showImport, setShowImport] = useState(false);
  const { data: companies } = useQuery({ queryKey: ["companies", "all"], queryFn: () => apiGet<Paged<CompanyListItem>>("/companies?pageSize=100") });

  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (search) params.set("search", search);
  if (companyId) params.set("companyId", companyId);
  const { data } = useQuery({ queryKey: ["employees", params.toString()], queryFn: () => apiGet<Paged<EmployeeRow>>(`/employees?${params}`) });

  return (
    <div className="space-y-6">
      <PageHeader title="Employees"
        actions={<>{can(PERMISSIONS.EMPLOYEES_WRITE) && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowImport(!showImport)}>{showImport ? "Close import" : "Import CSV"}</Button>
            <Link href="/employees/new" className={buttonVariants()}>New employee</Link>
          </div>
        )}</>}
      />
      {showImport && <EmployeeImport defaultCompanyId={companyId} />}
      <div className="flex flex-wrap gap-2">
        <Input
          className="w-56"
          placeholder="Search name or email"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <NativeSelect value={companyId} onChange={(e) => { setCompanyId(e.target.value); setPage(1); }}>
          <option value="">All companies</option>
          {companies?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Company</TableHead><TableHead>Can change</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
        <TableBody>
          {data?.items.map((e) => (
            <TableRow key={e.id}>
              <TableCell><Link className="underline" href={`/employees/${e.id}`}>{e.name}</Link></TableCell>
              <TableCell>{e.email}</TableCell>
              <TableCell>{e.company.name}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {[e.canChooseAddress && "address", e.canChangeTime && "time", e.canChangePackaging && "packaging"].filter(Boolean).join(", ") || "nothing"}
              </TableCell>
              <TableCell><Badge variant={e.active ? "secondary" : "outline"}>{e.active ? "Active" : "Inactive"}</Badge></TableCell>
            </TableRow>
          ))}
          {data?.items.length === 0 && <TableRow><TableCell colSpan={5} className="text-muted-foreground">No employees found.</TableCell></TableRow>}
        </TableBody>
      </Table>
      <Pagination page={page} pageSize={pageSize} onPageSize={(n) => { setPageSize(n); setPage(1); }} total={data?.total ?? 0} onPage={setPage} />
    </div>
  );
}
