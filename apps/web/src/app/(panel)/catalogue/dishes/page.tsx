"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PERMISSIONS, formatCents } from "@fernleaf/shared";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/native-select";
import { Pagination } from "@/components/pagination";
import { usePageSize } from "@/lib/use-page-size";
import { useReference } from "@/hooks/use-reference";
import { apiGet } from "@/lib/api";
import { useMe } from "@/lib/auth";
import type { DishListItem, Paged } from "@/lib/types";


export default function DishesPage() {
  const { can } = useMe();
  const stations = useReference("stations").data ?? [];
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("dishes");
  const [search, setSearch] = useState("");
  const [stationId, setStationId] = useState("");
  const [active, setActive] = useState("");

  // Filters become query-string parameters; the server does the searching and paging.
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (search) params.set("search", search);
  if (stationId) params.set("stationId", stationId);
  if (active) params.set("active", active);
  const { data } = useQuery({ queryKey: ["dishes", params.toString()], queryFn: () => apiGet<Paged<DishListItem>>(`/dishes?${params}`) });

  const resetPage = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  return (
    <div className="space-y-6">
      <PageHeader title="Dishes"
        actions={<>{can(PERMISSIONS.CATALOGUE_WRITE) && (
          <Link href="/catalogue/dishes/new" className={buttonVariants()}>New dish</Link>
        )}</>}
      />
      <div className="flex flex-wrap gap-2">
        <Input
          className="w-56"
          placeholder="Search name or SKU"
          value={search}
          onChange={(e) => resetPage(setSearch)(e.target.value)}
        />
        <NativeSelect value={stationId} onChange={(e) => resetPage(setStationId)(e.target.value)}>
          <option value="">All stations</option>
          {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </NativeSelect>
        <NativeSelect value={active} onChange={(e) => resetPage(setActive)(e.target.value)}>
          <option value="">Active and inactive</option>
          <option value="true">Active only</option>
          <option value="false">Inactive only</option>
        </NativeSelect>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>SKU</TableHead><TableHead>Name</TableHead><TableHead>Station</TableHead><TableHead>Temp</TableHead><TableHead>Cost</TableHead><TableHead>Min qty</TableHead><TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data?.items.map((d) => (
            <TableRow key={d.id}>
              <TableCell>{d.sku}</TableCell>
              <TableCell><Link className="underline" href={`/catalogue/dishes/${d.id}`}>{d.name}</Link></TableCell>
              <TableCell>{d.station?.name ?? <span className="text-muted-foreground">Unassigned</span>}</TableCell>
              <TableCell>{d.temperature === "HOT" ? "Hot" : "Cold"}</TableCell>
              <TableCell>{formatCents(d.costCents)}</TableCell>
              <TableCell>{d.minOrderQty ?? "–"}</TableCell>
              <TableCell><Badge variant={d.active ? "secondary" : "outline"}>{d.active ? "Active" : "Inactive"}</Badge></TableCell>
            </TableRow>
          ))}
          {data?.items.length === 0 && <TableRow><TableCell colSpan={7} className="text-muted-foreground">No dishes match.</TableCell></TableRow>}
        </TableBody>
      </Table>
      <Pagination page={page} pageSize={pageSize} onPageSize={(n) => { setPageSize(n); setPage(1); }} total={data?.total ?? 0} onPage={setPage} />
    </div>
  );
}
