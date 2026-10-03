import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { Named } from "@/lib/types";

export type ReferenceKind = "allergens" | "dietary-tags" | "stations" | "portion-sizes";

export const useReference = (kind: ReferenceKind) =>
  useQuery({ queryKey: ["reference", kind], queryFn: () => apiGet<Named[]>(`/reference/${kind}`) });
