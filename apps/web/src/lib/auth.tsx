"use client";

import { useQuery } from "@tanstack/react-query";
import type { Me } from "@fernleaf/shared";
import { ApiRequestError, apiGet } from "./api";

export const ME_KEY = ["me"];

// "Not signed in" is a normal answer (null), not an error.
export async function fetchMe(): Promise<Me | null> {
  try {
    return await apiGet<Me>("/auth/me");
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 401) return null;
    throw e;
  }
}

export function useMe() {
  const query = useQuery({ queryKey: ME_KEY, queryFn: fetchMe, retry: false });
  const me = query.data ?? null;
  // Used to show or hide UI only. The API enforces permissions again on every request.
  const can = (permission: string) => !!me?.permissions.includes(permission);
  return { me, can, isLoading: query.isLoading, error: query.error };
}
