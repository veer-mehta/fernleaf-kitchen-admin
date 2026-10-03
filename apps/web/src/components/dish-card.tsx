import { formatCents } from "@fernleaf/shared";
import type { MenuDish } from "@/lib/types";

export function DishCard({ dish }: { dish: MenuDish }) {
  return (
    <div className="rounded-md border p-3 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <b>{dish.name}</b>
        <span>{formatCents(dish.priceCents)}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {dish.sku} · {dish.temperature === "HOT" ? "Hot" : "Cold"}
        {dish.minOrderQty ? ` · min ${dish.minOrderQty}` : ""}
        {dish.allergens.length > 0 && ` · contains ${dish.allergens.join(", ")}`}
        {dish.dietaryTags.length > 0 && ` · ${dish.dietaryTags.join(", ")}`}
      </p>
      {dish.groups.map((g) => (
        <p key={g.groupId} className="mt-1 text-xs">
          <span className="font-medium">{g.name}</span> {g.required ? "(required)" : "(optional)"}:{" "}
          {g.options.map((o) => `${o.name}${o.priceCents ? ` +${formatCents(o.priceCents)}` : ""}`).join(", ")}
        </p>
      ))}
    </div>
  );
}
