import type { Named } from "@/lib/types";

// A row of checkboxes for picking several items from a list (allergens, dietary tags).
export function CheckList({ items, selected, onChange }: { items: Named[]; selected: number[]; onChange: (ids: number[]) => void }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">None defined yet.</p>;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {items.map((item) => (
        <label key={item.id} className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={selected.includes(item.id)}
            onChange={(e) => onChange(e.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))}
          />
          {item.name}
        </label>
      ))}
    </div>
  );
}
