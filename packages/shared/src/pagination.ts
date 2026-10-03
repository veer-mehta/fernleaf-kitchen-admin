import { z } from "zod";

// Query strings arrive as text, so numbers are coerced. pageSize is capped so nobody
// can ask the server for the whole table in one request.
export const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export interface Paged<T> {
  items: T[];
  total: number;
}
