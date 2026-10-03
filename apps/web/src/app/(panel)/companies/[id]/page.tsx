"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PERMISSIONS } from "@fernleaf/shared";
import { apiGet } from "@/lib/api";
import { useMe } from "@/lib/auth";
import type { CompanyDetail } from "@/lib/types";
import { DetailsForm } from "./details-form";
import { NewCompanyForm } from "./new-company-form";
import { AddressesCard, DomainsCard, HiddenMenuCard, HolidaysCard } from "./parts-cards";

export default function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useMe();
  const canEdit = can(PERMISSIONS.COMPANIES_WRITE);
  const isNew = id === "new";
  const { data: company, error } = useQuery({ queryKey: ["company", Number(id)], queryFn: () => apiGet<CompanyDetail>(`/companies/${id}`), enabled: !isNew });

  if (isNew) return <div className="space-y-4"><Link className="text-sm underline" href="/companies">← All companies</Link><NewCompanyForm /></div>;
  if (error) return <p className="text-destructive">{error.message}</p>;
  if (!company) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <div className="max-w-4xl space-y-4">
      <Link className="text-sm underline" href="/companies">← All companies</Link>
      <h1 className="text-xl font-semibold">{company.name}</h1>
      <DetailsForm key={`d-${company.id}-${company.name}`} company={company} canEdit={canEdit} />
      <DomainsCard company={company} canEdit={canEdit} />
      <AddressesCard company={company} canEdit={canEdit} />
      <HolidaysCard company={company} canEdit={canEdit} />
      {canEdit && <HiddenMenuCard key={`h-${company.id}`} company={company} canEdit={canEdit} />}
    </div>
  );
}
