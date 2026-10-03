"use client";

import { PERMISSIONS } from "@fernleaf/shared";
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
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Welcome, {me.name}</h1>
        <p className="text-sm text-muted-foreground">{me.role} dashboard</p>
      </div>
      {admin && <AdminDashboardView />}
      {!admin && can(PERMISSIONS.KITCHEN_READ) && <KitchenDashboardView />}
      {!admin && can(PERMISSIONS.DISPATCH_READ) && <DispatchDashboardView />}
      {!admin && can(PERMISSIONS.DRIVER_OWN_DROPS) && <DriverDashboardView />}
    </div>
  );
}
