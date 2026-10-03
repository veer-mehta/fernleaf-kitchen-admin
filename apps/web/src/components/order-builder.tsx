"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatCents } from "@fernleaf/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/native-select";
import { ApiRequestError, apiGet, apiPatch, apiPost, errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { CompanyDetail, CompanyListItem, EmployeeRow, Menu, MenuDish, OrderDetail, OrderRequest, Packaging, Paged } from "@/lib/types";

// ---- the screen's own state: text boxes hold text, and are turned into numbers only on save ----
interface ComboDraft { key: number; quantity: string; selections: Record<number, string>; sizes: Record<number, string> } // groupId -> optionId / sizeId ("" = none)
interface LineDraft { key: number; dishId: number; quantity: string; combos: ComboDraft[] }

let nextKey = 1;
const newKey = () => nextKey++;

function toInt(text: string): number | null {
  return /^\d+$/.test(text.trim()) ? Number(text) : null;
}

// Reads the saved request of an existing order back into screen state (used when editing).
function linesFromRequest(request: OrderRequest): LineDraft[] {
  return request.lines.map((l) => ({
    key: newKey(),
    dishId: l.dishId,
    quantity: String(l.quantity),
    combos: l.combinations.map((c) => ({
      key: newKey(),
      quantity: String(c.quantity),
      selections: Object.fromEntries(c.selections.map((s) => [s.groupId, String(s.optionId)])),
      sizes: Object.fromEntries(c.selections.filter((s) => s.portionSizeId !== undefined).map((s) => [s.groupId, String(s.portionSizeId)])),
    })),
  }));
}

// "lines.0.combinations.1.selections" -> "Dish 1, combination 2". Used to point at the right place.
function describeKey(key: string): string {
  const line = /^lines\.(\d+)/.exec(key);
  const combo = /combinations\.(\d+)/.exec(key);
  if (!line) return key === "_" ? "" : key.replace(/([A-Z])/g, " $1").toLowerCase().replace(/^./, (c) => c.toUpperCase());
  return `Dish ${Number(line[1]) + 1}${combo ? `, combination ${Number(combo[1]) + 1}` : ""}`;
}

export function OrderBuilder({ existing }: { existing?: OrderDetail }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState(existing ? String(existing.company.id) : "");
  const [employeeId, setEmployeeId] = useState(existing ? String(existing.employee.id) : "");
  const [deliveryDate, setDeliveryDate] = useState(existing?.deliveryDate ?? "");
  const [lines, setLines] = useState<LineDraft[]>(existing ? linesFromRequest(existing.request) : []);
  const [time, setTime] = useState(existing?.request.deliveryTime ?? "");
  const [addressId, setAddressId] = useState(existing?.request.addressId ? String(existing.request.addressId) : "");
  const [packaging, setPackaging] = useState<string>(existing?.request.packaging ?? "");
  const [pickDish, setPickDish] = useState("");
  const [problems, setProblems] = useState<string[]>([]);

  const { data: companies } = useQuery({ queryKey: ["companies", "all"], queryFn: () => apiGet<Paged<CompanyListItem>>("/companies?pageSize=100") });
  const { data: employees } = useQuery({
    queryKey: ["employees", "company", Number(companyId)],
    queryFn: () => apiGet<Paged<EmployeeRow>>(`/employees?companyId=${companyId}&pageSize=100`),
    enabled: !!companyId,
  });
  const { data: company } = useQuery({ queryKey: ["company", Number(companyId)], queryFn: () => apiGet<CompanyDetail>(`/companies/${companyId}`), enabled: !!companyId });
  const { data: menu } = useQuery({ queryKey: ["menu", Number(employeeId)], queryFn: () => apiGet<Menu>(`/employees/${employeeId}/menu`), enabled: !!employeeId });

  const employee = employees?.items.find((e) => String(e.id) === employeeId);
  const allDishes: MenuDish[] = menu ? [...menu.categories.flatMap((c) => c.dishes), ...menu.secretDishes] : [];
  const dishById = (id: number) => allDishes.find((d) => d.dishId === id);

  // ---- price preview (the server recalculates everything; this is only a guide) ----
  const comboUnit = (dish: MenuDish, combo: ComboDraft) =>
    dish.priceCents +
    dish.groups.reduce((sum, g) => {
      const option = g.options.find((o) => String(o.optionId) === combo.selections[g.groupId]);
      if (!option) return sum;
      const size = g.portions.find((p) => String(p.portionSizeId) === combo.sizes[g.groupId]);
      return sum + option.priceCents + (size?.extraCents ?? 0); // a size adds its own charge
    }, 0);
  const comboTotal = (dish: MenuDish, combo: ComboDraft) => comboUnit(dish, combo) * (toInt(combo.quantity) ?? 0);
  const total = lines.reduce((sum, l) => {
    const dish = dishById(l.dishId);
    return dish ? sum + l.combos.reduce((s, c) => s + comboTotal(dish, c), 0) : sum;
  }, 0);

  // ---- editing lines ----
  const updateLine = (key: number, patch: Partial<LineDraft>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => {
    const dishId = Number(pickDish);
    if (!dishId) return;
    setLines([...lines, { key: newKey(), dishId, quantity: "1", combos: [{ key: newKey(), quantity: "1", selections: {}, sizes: {} }] }]);
    setPickDish("");
  };
  const setLineQuantity = (line: LineDraft, quantity: string) => {
    // With a single combination, it simply follows the dish quantity.
    const combos = line.combos.length === 1 ? [{ ...line.combos[0], quantity }] : line.combos;
    updateLine(line.key, { quantity, combos });
  };
  const updateCombo = (line: LineDraft, comboKey: number, patch: Partial<ComboDraft>) =>
    updateLine(line.key, { combos: line.combos.map((c) => (c.key === comboKey ? { ...c, ...patch } : c)) });

  // ---- saving ----
  const save = useMutation({
    mutationFn: (status: "DRAFT" | "PLACED") => {
      const body = {
        employeeId: Number(employeeId),
        deliveryDate,
        status,
        // Left out unless chosen: the server then uses the company's defaults.
        ...(time ? { deliveryTime: time } : {}),
        ...(addressId ? { addressId: Number(addressId) } : {}),
        ...(packaging ? { packaging: packaging as Packaging } : {}),
        lines: lines.map((l) => ({
          dishId: l.dishId,
          quantity: toInt(l.quantity) ?? 0,
          combinations: l.combos.map((c) => ({
            quantity: toInt(c.quantity) ?? 0,
            selections: Object.entries(c.selections).filter(([, optionId]) => optionId).map(([groupId, optionId]) => ({
              groupId: Number(groupId),
              optionId: Number(optionId),
              ...(c.sizes[Number(groupId)] ? { portionSizeId: Number(c.sizes[Number(groupId)]) } : {}),
            })),
          })),
        })),
      };
      return existing ? apiPatch<OrderDetail>(`/orders/${existing.id}`, body) : apiPost<OrderDetail>("/orders", body);
    },
    onSuccess: (order) => {
      setProblems([]);
      // The detail page and the list must not show their cached, pre-save versions.
      queryClient.invalidateQueries({ queryKey: ["order"] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      order.warnings?.forEach((w) => toast.warning(w));
      toast.success(order.status === "DRAFT" ? "Draft saved" : "Order placed");
      router.push(`/orders/${order.id}`);
    },
    onError: (e) => {
      const fields = e instanceof ApiRequestError ? e.fields : undefined;
      setProblems(fields ? Object.entries(fields).map(([k, v]) => `${describeKey(k) ? describeKey(k) + ": " : ""}${v}`) : [errorMessage(e)]);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
  });

  const ready = !!employeeId && !!deliveryDate && lines.length > 0;
  const dishGroups = menu
    ? [...menu.categories.map((c) => ({ label: c.name, dishes: c.dishes })), ...(menu.secretDishes.length ? [{ label: "Secret categories", dishes: menu.secretDishes }] : [])]
    : [];

  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="text-xl font-semibold">{existing ? `Edit order #${existing.id}` : "New order"}</h1>

      {problems.length > 0 && (
        <div role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          <p className="font-medium">Please fix these before continuing:</p>
          <ul className="list-disc pl-5">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">1. Who and when</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="company">Company</label>
            <NativeSelect id="company" className="w-full" disabled={!!existing} value={companyId} onChange={(e) => { setCompanyId(e.target.value); setEmployeeId(""); setLines([]); }}>
              <option value="">Choose a company…</option>
              {companies?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="employee">Employee</label>
            <NativeSelect id="employee" className="w-full" disabled={!!existing || !companyId} value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setLines([]); }}>
              <option value="">Choose an employee…</option>
              {employees?.items.filter((e) => e.active).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="deliveryDate">Delivery date</label>
            <input id="deliveryDate" type="date" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
            {deliveryDate && <p className="text-xs text-muted-foreground">{formatDate(deliveryDate)}</p>}
          </div>
          {employee && (employee.allergens.length > 0 || employee.dietaryTags.length > 0) && (
            <p className="text-sm md:col-span-3">
              {employee.allergens.length > 0 && <>Allergic to: <b>{employee.allergens.map((a) => a.name).join(", ")}</b>. </>}
              {employee.dietaryTags.length > 0 && <>Prefers: <b>{employee.dietaryTags.map((t) => t.name).join(", ")}</b>.</>}
            </p>
          )}
        </CardContent>
      </Card>

      {employeeId && (
        <Card>
          <CardHeader><CardTitle className="text-base">2. Dishes</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {menu && allDishes.length === 0 && <p className="text-sm text-muted-foreground">This employee’s menu is empty (no dish has a price on their tier).</p>}
            {lines.map((line, li) => {
              const dish = dishById(line.dishId);
              if (!dish) return <p key={line.key} className="text-sm text-destructive">Dish {li + 1} is no longer on this employee’s menu. Remove it.</p>;
              const allocated = line.combos.reduce((s, c) => s + (toInt(c.quantity) ?? 0), 0);
              const lineQty = toInt(line.quantity) ?? 0;
              return (
                <div key={line.key} className="space-y-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="flex-1">{dish.name} <span className="font-normal text-muted-foreground">{formatCents(dish.priceCents)} each{dish.minOrderQty ? ` · min ${dish.minOrderQty}` : ""}</span></b>
                    <label className="flex items-center gap-1.5 text-sm">Quantity
                      <input aria-label={`Quantity of ${dish.name}`} inputMode="numeric" className="h-8 w-20 rounded-md border border-input bg-background px-2" value={line.quantity} onChange={(e) => setLineQuantity(line, e.target.value)} />
                    </label>
                    <Button size="sm" variant="ghost" onClick={() => setLines(lines.filter((l) => l.key !== line.key))}>Remove</Button>
                  </div>
                  {line.combos.map((combo, ci) => (
                    <div key={combo.key} className="flex flex-wrap items-center gap-2 rounded bg-muted/50 p-2 text-sm">
                      <span className="text-muted-foreground">#{ci + 1}</span>
                      <input aria-label={`Quantity of combination ${ci + 1} of ${dish.name}`} inputMode="numeric" className="h-8 w-16 rounded-md border border-input bg-background px-2" value={combo.quantity} onChange={(e) => updateCombo(line, combo.key, { quantity: e.target.value })} />
                      <span>with</span>
                      {dish.groups.length === 0 && <span className="text-muted-foreground">no choices</span>}
                      {dish.groups.map((g) => (
                        <span key={g.groupId} className="inline-flex gap-1">
                          <NativeSelect aria-label={`${g.name} for combination ${ci + 1} of ${dish.name}`} value={combo.selections[g.groupId] ?? ""} onChange={(e) => updateCombo(line, combo.key, { selections: { ...combo.selections, [g.groupId]: e.target.value } })}>
                            <option value="">{g.required ? `${g.name} (required)…` : `${g.name}: none`}</option>
                            {g.options.map((o) => <option key={o.optionId} value={o.optionId}>{o.name}{o.priceCents ? ` +${formatCents(o.priceCents)}` : ""}</option>)}
                          </NativeSelect>
                          {/* a group sold in sizes needs one chosen with the option */}
                          {g.portions.length > 0 && (
                            <NativeSelect aria-label={`Size of ${g.name} for combination ${ci + 1} of ${dish.name}`} value={combo.sizes[g.groupId] ?? ""} onChange={(e) => updateCombo(line, combo.key, { sizes: { ...combo.sizes, [g.groupId]: e.target.value } })}>
                              <option value="">Size…</option>
                              {g.portions.map((p) => <option key={p.portionSizeId} value={p.portionSizeId}>{p.name}{p.extraCents ? ` +${formatCents(p.extraCents)}` : ""}</option>)}
                            </NativeSelect>
                          )}
                        </span>
                      ))}
                      <span className="ml-auto font-medium">{formatCents(comboTotal(dish, combo))}</span>
                      {line.combos.length > 1 && <Button size="sm" variant="ghost" onClick={() => updateLine(line.key, { combos: line.combos.filter((c) => c.key !== combo.key) })}>✕</Button>}
                    </div>
                  ))}
                  <div className="flex items-center gap-3 text-sm">
                    <Button size="sm" variant="outline" onClick={() => updateLine(line.key, { combos: [...line.combos, { key: newKey(), quantity: "1", selections: {}, sizes: {} }] })}>Split into another combination</Button>
                    <span className={allocated === lineQty ? "text-muted-foreground" : "text-destructive"}>{allocated} of {lineQty} allocated to combinations</span>
                  </div>
                </div>
              );
            })}
            <div className="flex flex-wrap gap-2">
              <NativeSelect aria-label="Dish to add" value={pickDish} onChange={(e) => setPickDish(e.target.value)}>
                <option value="">Choose a dish to add…</option>
                {dishGroups.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.dishes.map((d) => <option key={d.dishId} value={d.dishId}>{d.name} · {formatCents(d.priceCents)}</option>)}
                  </optgroup>
                ))}
              </NativeSelect>
              <Button variant="outline" onClick={addLine} disabled={!pickDish}>Add dish</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {employeeId && company && (
        <Card>
          <CardHeader><CardTitle className="text-base">3. Delivery</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="address">Address</label>
              <NativeSelect id="address" className="w-full" disabled={!employee?.canChooseAddress} value={addressId} onChange={(e) => setAddressId(e.target.value)}>
                <option value="">Default ({company.addresses[0]?.label})</option>
                {company.addresses.slice(1).map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </NativeSelect>
              {!employee?.canChooseAddress && <p className="text-xs text-muted-foreground">This employee cannot choose an address.</p>}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="time">Delivery time</label>
              <input id="time" type="time" disabled={!employee?.canChangeTime} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60" value={time || company.deliveryTime} onChange={(e) => setTime(e.target.value === company.deliveryTime ? "" : e.target.value)} />
              {!employee?.canChangeTime && <p className="text-xs text-muted-foreground">This employee cannot change the time.</p>}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="packaging">Packaging</label>
              <NativeSelect id="packaging" className="w-full" disabled={!employee?.canChangePackaging} value={packaging} onChange={(e) => setPackaging(e.target.value)}>
                <option value="">Default ({company.defaultPackaging.toLowerCase()})</option>
                {(["STANDARD", "ECO", "INSULATED"] as const).filter((p) => p !== company.defaultPackaging).map((p) => <option key={p} value={p}>{p.toLowerCase()}</option>)}
              </NativeSelect>
              {!employee?.canChangePackaging && <p className="text-xs text-muted-foreground">This employee cannot change the packaging.</p>}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
        <span className="text-lg font-semibold">Total {formatCents(total)}</span>
        <span className="text-xs text-muted-foreground">Preview only. The server works out the final prices.</span>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" disabled={!ready || save.isPending} onClick={() => save.mutate("DRAFT")}>Save as draft</Button>
          <Button disabled={!ready || save.isPending} onClick={() => save.mutate("PLACED")}>{existing?.status === "PLACED" ? "Save changes" : "Place order"}</Button>
        </div>
      </div>
    </div>
  );
}
