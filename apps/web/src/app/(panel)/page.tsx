"use client";

import { PERMISSIONS } from "@fernleaf/shared";
import { PageHeader } from "@/components/page-header";
import { AdminDashboardView } from "@/components/dashboards/admin-dashboard";
import { DispatchDashboardView, DriverDashboardView, KitchenDashboardView } from "@/components/dashboards/role-dashboards";
import { useMe } from "@/lib/auth";

// Everyone lands here after signing in. What they see depends on what their role may do:
// the admin dashboard if they hold dashboard:admin, otherwise one per area they work in.
export default function HomePage() {
  const { me, can } = useMe();
  if (!me) return null;

  const admin = can(PERMISSIONS.DASHBOARD_ADMIN);
  return (
    <div className="space-y-6">
      <PageHeader title={`Welcome, ${me.name}`} description={`${me.role} dashboard`} />
      {admin && <AdminDashboardView />}
      {!admin && can(PERMISSIONS.KITCHEN_READ) && <KitchenDashboardView />}
      {!admin && can(PERMISSIONS.DISPATCH_READ) && <DispatchDashboardView />}
      {!admin && can(PERMISSIONS.DRIVER_OWN_DROPS) && <DriverDashboardView />}
    </div>
  );
}
