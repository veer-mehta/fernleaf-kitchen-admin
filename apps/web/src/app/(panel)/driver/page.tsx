"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ImageUpload } from "@/components/image-upload";
import { Input } from "@/components/ui/input";
import { apiGet, apiPost, errorMessage, fieldErrors } from "@/lib/api";
import { formatDate, formatTime } from "@/lib/format";
import { imageSrc } from "@/lib/safe-url";
import type { DriverDrop } from "@/lib/types";

const STATUS_TEXT = {
  OPEN: "Being prepared",
  DISPATCH_READY: "Ready: waiting for dispatch to send it out",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
} as const;

// Built for a phone: one column, big text and big buttons.
function DropCard({ drop }: { drop: DriverDrop }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoError, setPhotoError] = useState<string | undefined>();

  const deliver = useMutation({
    mutationFn: () => apiPost(`/driver/drops/${drop.id}/delivered`, { ...(note ? { note } : {}), ...(photoUrl ? { photoUrl } : {}) }),
    onSuccess: () => { toast.success("Marked as delivered"); setOpen(false); queryClient.invalidateQueries({ queryKey: ["driver"] }); },
    onError: (e) => { setPhotoError(fieldErrors(e)?.photoUrl); toast.error(errorMessage(e)); queryClient.invalidateQueries({ queryKey: ["driver"] }); },
  });
  const items = drop.orders.reduce((sum, o) => sum + o.itemCount, 0);
  const a = drop.address;

  return (
    <section className={`space-y-3 rounded-lg border p-4 ${drop.status === "DELIVERED" ? "bg-muted/40" : ""}`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-2xl font-semibold">{drop.deliveryTime}</p>
        <Badge variant={drop.status === "DELIVERED" ? "default" : "secondary"}>{STATUS_TEXT[drop.status]}</Badge>
      </div>
      <div>
        <p className="text-lg font-medium">{drop.company.name}</p>
        <p>{a.line1}{a.line2 ? `, ${a.line2}` : ""}</p>
        <p>{a.city} {a.postalCode}</p>
        {a.instructions && <p className="text-sm text-muted-foreground">{a.instructions}</p>}
      </div>
      {drop.instructions && <p className="rounded bg-amber-100 p-2 text-sm">{drop.instructions}</p>}
      <p className="text-sm">{items} item(s) for {drop.orders.map((o) => o.employeeName).join(", ")}</p>

      {drop.status === "OUT_FOR_DELIVERY" && !open && (
        <Button className="h-11 w-full text-base" onClick={() => setOpen(true)}>Mark delivered</Button>
      )}
      {open && (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); deliver.mutate(); }}>
          <Input className="h-11" placeholder="Note (optional)" aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
          <ImageUpload label="Delivery photo (optional)" value={photoUrl} onChange={setPhotoUrl} capture="environment" error={photoError} />
          <div className="flex gap-2">
            <Button type="submit" className="h-11 flex-1 text-base" disabled={deliver.isPending}>Confirm delivered</Button>
            <Button type="button" variant="outline" className="h-11" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </form>
      )}
      {drop.status === "DELIVERED" && (
        <p className="text-sm text-muted-foreground">
          Delivered {drop.deliveredAt ? formatTime(drop.deliveredAt) : ""}
          {drop.note && <> · “{drop.note}”</>}
          {imageSrc(drop.photoUrl) && <> · <a className="underline" href={imageSrc(drop.photoUrl)} target="_blank" rel="noreferrer noopener">photo</a></>}
        </p>
      )}
    </section>
  );
}

export default function DriverPage() {
  const { data, error } = useQuery({ queryKey: ["driver"], queryFn: () => apiGet<{ date: string; drops: DriverDrop[] }>("/driver/drops"), refetchInterval: 30_000 });
  return (
    <div className="mx-auto max-w-md space-y-4">
      <div>
        <PageHeader title="My deliveries" />
        {data && <p className="text-sm text-muted-foreground">{formatDate(data.date)}</p>}
      </div>
      {error && <p className="text-destructive">{error.message}</p>}
      {data?.drops.length === 0 && <p className="text-muted-foreground">No deliveries assigned to you today.</p>}
      {data?.drops.map((d) => <DropCard key={d.id} drop={d} />)}
    </div>
  );
}
