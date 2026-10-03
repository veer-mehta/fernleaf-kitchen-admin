"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PERMISSIONS } from "@fernleaf/shared";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pagination } from "@/components/pagination";
import { apiGet } from "@/lib/api";
import { useMe } from "@/lib/auth";
import type { CompanyListItem, Paged } from "@/lib/types";

const PAGE_SIZE = 10;

export default function CompaniesPage() {
  const { can } = useMe();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), ...(search ? { search } : {}) });
  const { data } = useQuery({ queryKey: ["companies", params.toString()], queryFn: () => apiGet<Paged<CompanyListItem>>(`/companies?${params}`) });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Companies</h1>
        {can(PERMISSIONS.COMPANIES_WRITE) && <Link href="/companies/new" className={buttonVariants()}>New company</Link>}
      </div>
      <input
        className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm"
        placeholder="Search companies"
        value={search}
        onChange={(e) => { setSearch(e.target.value); setPage(1); }}
      />
      <Table>
        <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Price tier</TableHead><TableHead>Email domains</TableHead><TableHead>Employees</TableHead></TableRow></TableHeader>
        <TableBody>
          {data?.items.map((c) => (
            <TableRow key={c.id}>
              <TableCell><Link className="underline" href={`/companies/${c.id}`}>{c.name}</Link></TableCell>
              <TableCell>{c.tier ? <Badge variant="secondary">{c.tier.name}</Badge> : <span className="text-muted-foreground">Default</span>}</TableCell>
              <TableCell>{c.domains.join(", ")}</TableCell>
              <TableCell>{c.employeeCount}</TableCell>
            </TableRow>
          ))}
          {data?.items.length === 0 && <TableRow><TableCell colSpan={4} className="text-muted-foreground">No companies found.</TableCell></TableRow>}
        </TableBody>
      </Table>
      <Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />
    </div>
  );
}
