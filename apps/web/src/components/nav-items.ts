import { PERMISSIONS } from "@fernleaf/shared";

// The sidebar. An item shows only if the user holds its permission. Each phase adds its pages here.
export interface NavItem {
  label: string;
  href: string;
  permission?: string; // omitted = every signed-in user
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Home", href: "/" },
  { label: "Dishes", href: "/catalogue/dishes", permission: PERMISSIONS.CATALOGUE_READ },
  { label: "Options", href: "/catalogue/options", permission: PERMISSIONS.CATALOGUE_READ },
  { label: "Categories", href: "/catalogue/categories", permission: PERMISSIONS.CATALOGUE_READ },
  { label: "Lists", href: "/catalogue/reference", permission: PERMISSIONS.CATALOGUE_READ },
  { label: "Pricing", href: "/pricing", permission: PERMISSIONS.PRICING_READ },
  { label: "Staff", href: "/staff", permission: PERMISSIONS.STAFF_READ },
];
