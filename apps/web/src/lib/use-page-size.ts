import { useState } from "react";
import { PAGE_SIZES } from "@/lib/pagination";

// The rows-per-page choice for one list, remembered in this browser. Each list has its own key,
// so choosing 50 orders does not change the dishes list. Storage can be blocked, so every access is guarded.
export function usePageSize(key: string): [number, (size: number) => void] {
  const storageKey = `pageSize:${key}`;
  const [size, setSize] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey));
      if ((PAGE_SIZES as readonly number[]).includes(saved)) return saved;
    } catch {}
    return PAGE_SIZES[0];
  });
  function update(next: number) {
    setSize(next);
    try {
      localStorage.setItem(storageKey, String(next));
    } catch {}
  }
  return [size, update];
}
