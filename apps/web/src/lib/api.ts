import type { ApiError } from "@fernleaf/shared";

// Thrown for any non-2xx answer. `fields` carries per-input messages from the server
// so forms can show them next to the right input.
export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined; // e.g. an HTML error page from the proxy when the API is down
  }

  if (!res.ok) {
    const err = data as Partial<ApiError> | undefined;
    throw new ApiRequestError(
      res.status,
      err?.code ?? "UNKNOWN",
      err?.message ?? "The server could not be reached. Please try again.",
      err?.fields,
    );
  }
  return data as T;
}

export const apiGet = <T>(path: string) => request<T>("GET", path);
export const apiPost = <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {});
export const apiPatch = <T>(path: string, body: unknown) => request<T>("PATCH", path, body);
export const apiPut = <T>(path: string, body: unknown) => request<T>("PUT", path, body);
export const apiDelete = <T>(path: string) => request<T>("DELETE", path);

// Helpers for forms: a readable message and the per-field messages from the server.
export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
export const fieldErrors = (e: unknown) => (e instanceof ApiRequestError ? e.fields : undefined);
