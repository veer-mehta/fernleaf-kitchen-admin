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
