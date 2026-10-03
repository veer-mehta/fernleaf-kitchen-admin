"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/form-field";
import { NativeSelect } from "@/components/native-select";
import { apiGet, apiPatch, errorMessage, fieldErrors } from "@/lib/api";
import { WEEKDAY_NAMES } from "@/lib/format";
import type { CompanyDetail, EmployeeRow, Named, Packaging, Paged } from "@/lib/types";

interface Props {
  company: CompanyDetail;
  canEdit: boolean;
}

export function DetailsForm({ company, canEdit }: Props) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(company.name);
  const [tierId, setTierId] = useState(company.priceTierId ? String(company.priceTierId) : "");
  const [ownerId, setOwnerId] = useState(company.ownerEmployee ? String(company.ownerEmployee.id) : "");
  const [driverId, setDriverId] = useState(company.defaultDriver ? String(company.defaultDriver.id) : "");
  const [billing, setBilling] = useState({ name: company.billingContactName, email: company.billingContactEmail, phone: company.billingContactPhone });
  const [workingDays, setWorkingDays] = useState(company.workingDays);
  const [deliveryTime, setDeliveryTime] = useState(company.deliveryTime);
  const [deliveryMinutes, setDeliveryMinutes] = useState(String(company.deliveryMinutes));
  const [packaging, setPackaging] = useState<Packaging>(company.defaultPackaging);
  const [instructions, setInstructions] = useState(company.driverInstructions);
  const [errors, setErrors] = useState<Record<string, string> | undefined>();

  // The price tier list needs pricing:read, so non-admins just see the current value.
  const { data: tiers = [] } = useQuery({ queryKey: ["tiers"], queryFn: () => apiGet<Named[]>("/tiers"), retry: false });
  const { data: drivers = [] } = useQuery({ queryKey: ["drivers"], queryFn: () => apiGet<{ id: number; name: string }[]>("/drivers") });
  const { data: staff } = useQuery({
    queryKey: ["employees", "company", company.id],
    queryFn: () => apiGet<Paged<EmployeeRow>>(`/employees?companyId=${company.id}&pageSize=100`),
    retry: false,
  });

  const save = useMutation({
    mutationFn: () =>
      apiPatch(`/companies/${company.id}`, {
        name,
        priceTierId: tierId ? Number(tierId) : null,
        ownerEmployeeId: ownerId ? Number(ownerId) : null,
        defaultDriverId: driverId ? Number(driverId) : null,
        billingContactName: billing.name,
        billingContactEmail: billing.email,
        billingContactPhone: billing.phone,
        workingDays,
        deliveryTime,
        deliveryMinutes: Number(deliveryMinutes),
        defaultPackaging: packaging,
        driverInstructions: instructions,
      }),
    onSuccess: () => {
      setErrors(undefined);
      queryClient.invalidateQueries({ queryKey: ["company", company.id] });
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      toast.success("Company saved");
    },
    onError: (e) => { setErrors(fieldErrors(e)); toast.error(errorMessage(e)); },
  });

  const toggleDay = (day: number) =>
    setWorkingDays(workingDays.includes(day) ? workingDays.filter((d) => d !== day) : [...workingDays, day].sort());

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Company details</CardTitle></CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <fieldset disabled={!canEdit} className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <FormField name="name" label="Name" value={name} onChange={(e) => setName(e.target.value)} errors={errors} />
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="tier">Price tier</label>
                <NativeSelect id="tier" className="w-full" value={tierId} onChange={(e) => setTierId(e.target.value)}>
                  <option value="">Default tier</option>
                  {tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  {tierId && !tiers.some((t) => String(t.id) === tierId) && <option value={tierId}>{company.priceTier?.name}</option>}
                </NativeSelect>
                {errors?.priceTierId && <p className="text-sm text-destructive">{errors.priceTierId}</p>}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="owner">Owner (one of the employees)</label>
                <NativeSelect id="owner" className="w-full" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                  <option value="">None</option>
                  {staff?.items.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.email})</option>)}
                  {ownerId && !staff && <option value={ownerId}>{company.ownerEmployee?.name}</option>}
                </NativeSelect>
                {errors?.ownerEmployeeId && <p className="text-sm text-destructive">{errors.ownerEmployeeId}</p>}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="driver">Default driver</label>
                <NativeSelect id="driver" className="w-full" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                  <option value="">None</option>
                  {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </NativeSelect>
                {errors?.defaultDriverId && <p className="text-sm text-destructive">{errors.defaultDriverId}</p>}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5 md:col-span-1">
                <FormField name="billingContactName" label="Billing contact" value={billing.name} onChange={(e) => setBilling({ ...billing, name: e.target.value })} errors={errors} />
              </div>
              <FormField name="billingContactEmail" label="Billing email" value={billing.email} onChange={(e) => setBilling({ ...billing, email: e.target.value })} errors={errors} />
              <FormField name="billingContactPhone" label="Billing phone" value={billing.phone} onChange={(e) => setBilling({ ...billing, phone: e.target.value })} errors={errors} />
            </div>

            <div>
              <p className="mb-1 text-sm font-medium">Working days (deliveries only on these days)</p>
              <div className="flex flex-wrap gap-3">
                {WEEKDAY_NAMES.map((label, i) => (
                  <label key={label} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={workingDays.includes(i + 1)} onChange={() => toggleDay(i + 1)} /> {label}
                  </label>
                ))}
              </div>
              {errors && Object.keys(errors).some((k) => k.startsWith("workingDays")) && <p className="text-sm text-destructive">Pick at least one valid working day</p>}
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <FormField name="deliveryTime" label="Default delivery time (HH:mm)" value={deliveryTime} onChange={(e) => setDeliveryTime(e.target.value)} errors={errors} />
              <FormField name="deliveryMinutes" label="Minutes the order must leave before delivery" inputMode="numeric" value={deliveryMinutes} onChange={(e) => setDeliveryMinutes(e.target.value)} errors={errors} />
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="packaging">Default packaging</label>
                <NativeSelect id="packaging" className="w-full" value={packaging} onChange={(e) => setPackaging(e.target.value as Packaging)}>
                  <option value="STANDARD">Standard</option><option value="ECO">Eco</option><option value="INSULATED">Insulated</option>
                </NativeSelect>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="instructions">Standing instructions for the driver</label>
              <Textarea id="instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
            </div>
          </fieldset>
          {canEdit && <Button type="submit" disabled={save.isPending}>Save company</Button>}
        </form>
      </CardContent>
    </Card>
  );
}
