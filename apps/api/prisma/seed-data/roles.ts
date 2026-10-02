import { ALL_PERMISSIONS, PERMISSIONS as P } from "@fernleaf/shared";

// Which permissions each role gets. This is data, not code: changing it (or adding a role)
// never touches a controller. Every role also gets its own dashboard.
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  Admin: [...ALL_PERMISSIONS],
  Kitchen: [P.KITCHEN_READ, P.KITCHEN_UPDATE, P.CATALOGUE_READ, P.ORDERS_READ, P.DASHBOARD_READ],
  Dispatch: [
    P.DISPATCH_READ,
    P.DISPATCH_UPDATE,
    P.ORDERS_READ,
    P.COMPANIES_READ,
    P.DASHBOARD_READ,
  ],
  Driver: [P.DRIVER_OWN_DROPS, P.DASHBOARD_READ],
};

// The four accounts the reviewers will sign in with.
export const TEST_ACCOUNTS = [
  { email: "admin@test.com", name: "Asha Admin", role: "Admin" },
  { email: "kitchen@test.com", name: "Kiran Kitchen", role: "Kitchen" },
  { email: "dispatch@test.com", name: "Dev Dispatch", role: "Dispatch" },
  { email: "driver@test.com", name: "Dinesh Driver", role: "Driver" },
];
export const TEST_PASSWORD = "Test@1234";
