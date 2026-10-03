"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/native-select";
import { ApiRequestError, apiGet, apiPost, errorMessage } from "@/lib/api";
import type { CompanyListItem, Paged } from "@/lib/types";

interface ImportResult {
  total: number;
  imported: number;
  failed: number;
  errors: { row: number; name: string; email: string; message: string }[];
}

// Bulk-add a company's employees. The browser reads the file and sends its text; the server checks it row by row.
export function EmployeeImport({ defaultCompanyId }: { defaultCompanyId?: string }) {
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState(defaultCompanyId ?? "");
  const [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const { data: companies } = useQuery({ queryKey: ["companies", "all"], queryFn: () => apiGet<Paged<CompanyListItem>>("/companies?pageSize=100") });

  const upload = useMutation({
    mutationFn: () => apiPost<ImportResult>(`/companies/${companyId}/employees/import`, { csv }),
    onSuccess: (r) => {
      setResult(r);
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["companies"] });
    },
  });
  // A broken file is refused as a whole; show the reason under the picker.
  const fileProblem = upload.error instanceof ApiRequestError ? (upload.error.fields?.csv ?? upload.error.message) : upload.error ? errorMessage(upload.error) : null;

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Import employees from a CSV file</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Columns: <b>name</b> and <b>email</b> are required. Optional: canChooseAddress, canChangeTime, canChangePackaging (yes/no), allergies and dietaryPreferences (names separated by <code>;</code>).
          Each email must be at one of the company’s domains. Rows with a problem are listed below with the reason; the other rows are still imported.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm"><span className="block text-xs text-muted-foreground">Company</span>
            <NativeSelect aria-label="Company to import into" value={companyId} onChange={(e) => { setCompanyId(e.target.value); setResult(null); }}>
              <option value="">Choose a company…</option>
              {companies?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </NativeSelect></label>
          <label className="space-y-1 text-sm"><span className="block text-xs text-muted-foreground">CSV file</span>
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label="CSV file"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                setResult(null);
                upload.reset();
                setFileName(file?.name ?? "");
                setCsv(file ? await file.text() : "");
              }}
            /></label>
          <Button disabled={!companyId || !csv || upload.isPending} onClick={() => upload.mutate()}>{upload.isPending ? "Importing…" : "Import"}</Button>
        </div>
        {fileProblem && <p role="alert" className="text-sm text-destructive">{fileName ? `${fileName}: ` : ""}{fileProblem}</p>}
        {result && (
          <div className="space-y-2" aria-live="polite">
            <p className="text-sm"><b>{result.imported}</b> of {result.total} row(s) imported{result.failed > 0 && <>, <b className="text-destructive">{result.failed}</b> skipped</>}.</p>
            {result.errors.length > 0 && (
              <Table>
                <TableHeader><TableRow><TableHead>Row</TableHead><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Problem</TableHead></TableRow></TableHeader>
                <TableBody>{result.errors.map((e) => (
                  <TableRow key={e.row}><TableCell>{e.row}</TableCell><TableCell>{e.name || "–"}</TableCell><TableCell>{e.email || "–"}</TableCell><TableCell className="text-destructive">{e.message}</TableCell></TableRow>
                ))}</TableBody>
              </Table>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
