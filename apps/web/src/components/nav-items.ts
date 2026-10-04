import { PERMISSIONS } from "@fernleaf/shared";
import { BookOpen, BookText, Building2, ChefHat, ClipboardList, LayoutDashboard, LayoutGrid, PackageCheck, Receipt, Settings, SlidersHorizontal, Tag, Truck, UserCog, Users, UtensilsCrossed, type LucideIcon } from "lucide-react";

// The sidebar. An item shows only if the user holds its permission. Each phase adds its pages here.
export interface NavItem {
  label: string;
  icon: LucideIcon;
  href: string;
  permission?: string; // omitted = every signed-in user
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Home", icon: LayoutDashboard, href: "/" },
  { label: "Kitchen board", icon: ChefHat, href: "/kitchen", permission: PERMISSIONS.KITCHEN_READ },
  { label: "Dispatch board", icon: Truck, href: "/dispatch", permission: PERMISSIONS.DISPATCH_READ },
  { label: "My deliveries", icon: PackageCheck, href: "/driver", permission: PERMISSIONS.DRIVER_OWN_DROPS },
  { label: "Dishes", icon: UtensilsCrossed, href: "/catalogue/dishes", permission: PERMISSIONS.CATALOGUE_READ },
  { label: "Options", icon: SlidersHorizontal, href: "/catalogue/options", permission: PERMISSIONS.CATALOGUE_READ },
  { label: "Categories", icon: LayoutGrid, href: "/catalogue/categories", permission: PERMISSIONS.CATALOGUE_READ },
  { label: "Lists", icon: BookText, href: "/catalogue/reference", permission: PERMISSIONS.CATALOGUE_READ },
  { label: "Pricing", icon: Tag, href: "/pricing", permission: PERMISSIONS.PRICING_READ },
  { label: "Orders", icon: ClipboardList, href: "/orders", permission: PERMISSIONS.ORDERS_READ },
  { label: "Companies", icon: Building2, href: "/companies", permission: PERMISSIONS.COMPANIES_READ },
  { label: "Employees", icon: Users, href: "/employees", permission: PERMISSIONS.EMPLOYEES_READ },
  { label: "Menu preview", icon: BookOpen, href: "/menu-preview", permission: PERMISSIONS.EMPLOYEES_READ },
  { label: "Billing", icon: Receipt, href: "/billing", permission: PERMISSIONS.BILLING_READ },
  { label: "Settings", icon: Settings, href: "/settings", permission: PERMISSIONS.SETTINGS_READ },
  { label: "Staff", icon: UserCog, href: "/staff", permission: PERMISSIONS.STAFF_READ },
];
