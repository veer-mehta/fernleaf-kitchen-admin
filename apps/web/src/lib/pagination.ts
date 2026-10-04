// Rows per page the user may choose. The API refuses anything above 100 (see PageQuery in the shared package).
export const PAGE_SIZES = [10, 20, 50, 100] as const;

export function pageRangeLabel(page: number, pageSize: number, total: number): string {
  if (total === 0) return "0 results";
  return `${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, total)} of ${total}`;
}
