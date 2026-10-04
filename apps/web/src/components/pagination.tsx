import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/native-select";
import { PAGE_SIZES, pageRangeLabel } from "@/lib/pagination";

interface Props {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}

export function Pagination({ page, pageSize, total, onPage, onPageSize }: Props) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{pageRangeLabel(page, pageSize, total)}</span>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-muted-foreground">
          Rows per page
          <NativeSelect aria-label="Rows per page" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </NativeSelect>
        </label>
        <div className="flex items-center gap-2">
          <Button variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            Previous
          </Button>
          <span className="text-muted-foreground">Page {page} of {pages}</span>
          <Button variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
