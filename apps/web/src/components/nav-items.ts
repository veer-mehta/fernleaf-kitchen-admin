import { PERMISSIONS } from "@fernleaf/shared";

// The sidebar. An item shows only if the user holds its permission. Each phase adds its pages here.
export interface NavItem {
  label: string;
  href: string;
  permission?: string; // omitted = every signed-in user
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Home", href: "/" },
  { label: "Staff", href: "/staff", permission: PERMISSIONS.STAFF_READ },
];
