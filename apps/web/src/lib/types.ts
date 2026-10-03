// Shapes returned by the API (kept in one place so screens agree with each other).
export interface Named {
  id: number;
  name: string;
}
export interface Paged<T> {
  items: T[];
  total: number;
}
export interface DishListItem {
  id: number;
  sku: string;
  name: string;
  temperature: "HOT" | "COLD";
  costCents: number;
  station: Named | null;
  minOrderQty: number | null;
  active: boolean;
}
export interface DishGroup {
  id: number;
  name: string;
  required: boolean;
  usesPortions: boolean;
  options: { id: number; name: string; costCents: number; active: boolean }[];
}
export interface DishDetail extends Omit<DishListItem, "station"> {
  description: string;
  imageUrl: string | null;
  stationId: number | null;
  station: Named | null;
  allergens: Named[];
  dietaryTags: Named[];
  groups: DishGroup[];
}
export interface OptionItem {
  id: number;
  name: string;
  costCents: number;
  active: boolean;
  allergens: Named[];
  dietaryTags: Named[];
}
export interface CategoryItemRow {
  dishId: number;
  sku: string;
  name: string;
  active: boolean;
}
export interface CategoryRow {
  id: number;
  name: string;
  active: boolean;
  isSecret: boolean;
  items: CategoryItemRow[];
}
export type Derivation =
  | { type: "NONE" }
  | { type: "COST_MULTIPLE"; multiplierMilli: number }
  | { type: "TIER_PERCENT"; percentBp: number; baseTierId: number };
export interface Tier {
  id: number;
  name: string;
  isDefault: boolean;
  derivation: Derivation;
}
export interface TierGrid {
  tier: Tier;
  dishes: { dishId: number; sku: string; name: string; active: boolean; costCents: number; priceCents: number | null; isOverride: boolean }[];
  options: { optionId: number; name: string; active: boolean; costCents: number; priceCents: number | null; isOverride: boolean }[];
}
export interface MissingReport {
  dishes: { dishId: number; sku: string; name: string }[];
  options: { optionId: number; name: string }[];
}

// ---------- companies and employees ----------
export interface CompanyListItem {
  id: number;
  name: string;
  tier: Named | null;
  employeeCount: number;
  domains: string[];
}
export interface Address {
  id: number;
  label: string;
  line1: string;
  line2: string;
  city: string;
  postalCode: string;
  instructions: string;
}
export type Packaging = "STANDARD" | "ECO" | "INSULATED";
export interface CompanyDetail {
  id: number;
  name: string;
  priceTierId: number | null;
  priceTier: Named | null;
  billingContactName: string;
  billingContactEmail: string;
  billingContactPhone: string;
  ownerEmployee: Named | null;
  workingDays: number[];
  deliveryTime: string;
  deliveryMinutes: number;
  defaultPackaging: Packaging;
  driverInstructions: string;
  defaultDriver: Named | null;
  domains: { id: number; domain: string }[];
  addresses: Address[];
  holidays: { id: number; date: string; name: string }[];
  hiddenCategoryIds: number[];
  hiddenDishIds: number[];
}
export interface EmployeeRow {
  id: number;
  email: string;
  name: string;
  active: boolean;
  canChooseAddress: boolean;
  canChangeTime: boolean;
  canChangePackaging: boolean;
  company: Named;
  allergens: Named[];
  dietaryTags: Named[];
}

// ---------- menu and orders ----------
export interface MenuOption { optionId: number; name: string; priceCents: number; allergens: string[]; dietaryTags: string[] }
export interface MenuGroup { groupId: number; name: string; required: boolean; options: MenuOption[] }
export interface MenuDish {
  dishId: number; sku: string; name: string; description: string; imageUrl: string | null;
  temperature: "HOT" | "COLD"; priceCents: number; minOrderQty: number | null;
  allergens: string[]; dietaryTags: string[]; groups: MenuGroup[];
}
export interface Menu {
  tierId: number | null;
  categories: { id: number; name: string; dishes: MenuDish[] }[];
  secretDishes: MenuDish[];
}
export type OrderStatus = "DRAFT" | "PLACED" | "CONFIRMED" | "DELIVERED" | "CANCELLED" | "REJECTED";
export interface OrderListItem {
  id: number; status: OrderStatus; deliveryDate: string; deliveryTime: string;
  company: Named; employee: Named; totalCents: number; invoiced: boolean; itemCount: number;
}
export interface OrderRequest {
  employeeId: number; deliveryDate: string; deliveryTime?: string; addressId?: number; packaging?: Packaging;
  status: "DRAFT" | "PLACED";
  lines: { dishId: number; quantity: number; combinations: { quantity: number; selections: { groupId: number; optionId: number }[] }[] }[];
}
export interface OrderDetail {
  id: number; status: OrderStatus; rejectionReason: string | null;
  company: Named; employee: { id: number; name: string; email: string };
  deliveryDate: string; deliveryTime: string; address: Address; packaging: Packaging;
  cutoffAt: string; plannedDispatchReadyAt: string; plannedKitchenReadyAt: string;
  kitchenStartedAt: string | null; kitchenReadyAt: string | null; dispatchReadyAt: string | null;
  outForDeliveryAt: string | null; deliveredAt: string | null; onTime: boolean | null;
  totalCents: number; invoiceId: number | null; dropId: number | null;
  request: OrderRequest;
  lines: {
    id: number; dishId: number; dishName: string; sku: string; station: string | null; quantity: number; lineTotalCents: number;
    combinations: { id: number; quantity: number; options: { groupName: string; optionName: string; portion: string | null; priceCents: number }[]; unitPriceCents: number; lineTotalCents: number }[];
  }[];
  timeline: { type: string; actor: string; at: string; meta: Record<string, unknown> | null }[];
  warnings?: string[];
}

// ---------- kitchen, dispatch and driver ----------
export type Urgency = "late" | "at_risk" | "ok";
export type UnitStatus = "PENDING" | "STARTED" | "DONE";
export interface KitchenUnit {
  unitId: number; orderId: number; companyName: string; dishName: string; optionsSummary: string; quantity: number;
  status: UnitStatus; startedAt: string | null; doneAt: string | null; deliveryTime: string; plannedKitchenReadyAt: string; urgency: Urgency;
}
export interface KitchenBoard {
  date: string;
  stations: { stationId: number | null; name: string; units: KitchenUnit[]; counts: { pending: number; started: number; done: number } }[];
  totals: { pending: number; started: number; done: number; late: number; atRisk: number };
}
export type DropStatus = "OPEN" | "DISPATCH_READY" | "OUT_FOR_DELIVERY" | "DELIVERED";
export type DropStep = "dispatch-ready" | "out-for-delivery" | "delivered";
export interface DispatchDrop {
  id: number; deliveryTime: string; status: DropStatus; company: Named; address: { id: number; label: string; line1: string; city: string };
  driver: Named | null; late: boolean; nextAction: DropStep | null; blocker: string | null; note: string | null; photoUrl: string | null; deliveredAt: string | null;
  orders: { id: number; employeeName: string; itemCount: number; stage: string; plannedDispatchReadyAt: string }[];
}
export interface DispatchBoard {
  date: string; drops: DispatchDrop[];
  totals: { open: number; dispatchReady: number; outForDelivery: number; delivered: number; unassigned: number; late: number };
}
export interface DriverDrop {
  id: number; deliveryTime: string; status: DropStatus; company: Named; instructions: string;
  address: { label: string; line1: string; line2: string; city: string; postalCode: string; instructions: string };
  orders: { id: number; employeeName: string; itemCount: number }[]; note: string | null; photoUrl: string | null; deliveredAt: string | null;
}
