"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/form-field";
import { apiPost, errorMessage, fieldErrors } from "@/lib/api";
import type { CompanyDetail } from "@/lib/types";

// The minimum a company needs to exist: a name, an email domain and a delivery address.
// Everything else (tier, calendar, delivery defaults...) is set on the company page afterwards.
export function NewCompanyForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [domains, setDomains] = useState("");
  const [address, setAddress] = useState({ label: "Head office", line1: "", city: "", postalCode: "" });
  const [errors, setErrors] = useState<Record<string, string> | undefined>();

  const create = useMutation({
    mutationFn: () =>
      apiPost<CompanyDetail>("/companies", {
        name,
        domains: domains.split(",").map((d) => d.trim()).filter(Boolean),
        addresses: [address],
      }),
    onSuccess: (company) => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      toast.success("Company created");
      router.replace(`/companies/${company.id}`);
    },
    onError: (e) => { setErrors(fieldErrors(e)); toast.error(errorMessage(e)); },
  });

  return (
    <Card className="max-w-2xl">
      <CardHeader><CardTitle className="text-base">New company</CardTitle></CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <FormField name="name" label="Company name" value={name} onChange={(e) => setName(e.target.value)} errors={errors} />
          <FormField name="domains" label="Email domains (comma separated, e.g. acme.com)" value={domains} onChange={(e) => setDomains(e.target.value)} errors={errors} />
          <p className="text-sm font-medium">First delivery address</p>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField name="label" label="Name" value={address.label} onChange={(e) => setAddress({ ...address, label: e.target.value })} errors={errors} />
            <FormField name="line1" label="Address line" value={address.line1} onChange={(e) => setAddress({ ...address, line1: e.target.value })} errors={errors} />
            <FormField name="city" label="City" value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value })} errors={errors} />
            <FormField name="postalCode" label="Postal code" value={address.postalCode} onChange={(e) => setAddress({ ...address, postalCode: e.target.value })} errors={errors} />
          </div>
          {errors?.addresses && <p className="text-sm text-destructive">{errors.addresses}</p>}
          <Button type="submit" disabled={create.isPending}>Create company</Button>
        </form>
      </CardContent>
    </Card>
  );
}
