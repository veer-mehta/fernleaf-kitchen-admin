import { formatCents } from "@fernleaf/shared";
import { imageSrc } from "@/lib/safe-url";
import type { MenuDish } from "@/lib/types";

export function DishCard({ dish }: { dish: MenuDish }) {
  const picture = imageSrc(dish.imageUrl);
  return (
    <div className="rounded-md border p-3 text-sm">
      {/* eslint-disable-next-line @next/next/no-img-element -- an uploaded picture, already shrunk */}
      {picture && <img src={picture} alt={dish.name} loading="lazy" className="mb-2 h-28 w-full rounded object-cover" />}
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
          <span className="font-medium">{g.name}</span> {g.required ? "(required)" : "(optional)"}
          {g.portions.length > 0 && <> sizes: {g.portions.map((p) => `${p.name}${p.extraCents ? ` +${formatCents(p.extraCents)}` : ""}`).join(", ")}</>}:{" "}
          {g.options.map((o) => `${o.name}${o.priceCents ? ` +${formatCents(o.priceCents)}` : ""}`).join(", ")}
        </p>
      ))}
    </div>
  );
}
