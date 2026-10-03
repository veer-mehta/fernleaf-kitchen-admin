"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PERMISSIONS, formatCents } from "@fernleaf/shared";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/native-select";
import { Pagination } from "@/components/pagination";
import { useReference } from "@/hooks/use-reference";
import { apiGet } from "@/lib/api";
import { useMe } from "@/lib/auth";
import type { DishListItem, Paged } from "@/lib/types";

const PAGE_SIZE = 10;

export default function DishesPage() {
  const { can } = useMe();
  const stations = useReference("stations").data ?? [];
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [stationId, setStationId] = useState("");
  const [active, setActive] = useState("");

  // Filters become query-string parameters; the server does the searching and paging.
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (search) params.set("search", search);
  if (stationId) params.set("stationId", stationId);
  if (active) params.set("active", active);
  const { data } = useQuery({ queryKey: ["dishes", params.toString()], queryFn: () => apiGet<Paged<DishListItem>>(`/dishes?${params}`) });

  const resetPage = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Dishes</h1>
        {can(PERMISSIONS.CATALOGUE_WRITE) && (
          <Link href="/catalogue/dishes/new" className={buttonVariants()}>New dish</Link>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          className="h-9 w-56 rounded-md border border-input bg-background px-3 text-sm"
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
      <Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />
    </div>
  );
}
