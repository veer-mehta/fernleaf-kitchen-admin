// Permission codes. Roles get sets of these in the database (seed data), so adding a role
// never needs a code change. Controllers use @RequirePermission(PERMISSIONS.x).
export const PERMISSIONS = {
  CATALOGUE_READ: "catalogue:read",
  CATALOGUE_WRITE: "catalogue:write",
  PRICING_READ: "pricing:read",
  PRICING_WRITE: "pricing:write",
  COMPANIES_READ: "companies:read",
  COMPANIES_WRITE: "companies:write",
  EMPLOYEES_READ: "employees:read",
  EMPLOYEES_WRITE: "employees:write",
  ORDERS_READ: "orders:read",
  ORDERS_WRITE: "orders:write",
  ORDERS_OVERRIDE: "orders:override",
  KITCHEN_READ: "kitchen:read",
  KITCHEN_UPDATE: "kitchen:update",
  DISPATCH_READ: "dispatch:read",
  DISPATCH_UPDATE: "dispatch:update",
  DRIVER_OWN_DROPS: "driver:own-drops",
  BILLING_READ: "billing:read",
  BILLING_WRITE: "billing:write",
  SETTINGS_READ: "settings:read",
  SETTINGS_WRITE: "settings:write",
  STAFF_READ: "staff:read",
  STAFF_WRITE: "staff:write",
  DASHBOARD_READ: "dashboard:read",
  DASHBOARD_ADMIN: "dashboard:admin", // the admin dashboard: orders, billing and pricing gaps
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);
