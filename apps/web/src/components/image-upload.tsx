"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";
import { uploadImage } from "@/lib/image";
import { imageSrc } from "@/lib/safe-url";

interface Props {
  label: string;
  value: string; // the stored picture's path or link, "" when there is none
  onChange: (value: string) => void;
  // "environment" opens the phone's back camera straight away (the driver's delivery photo).
  capture?: "environment";
  error?: string;
  className?: string;
}

export function ImageUpload({ label, value, onChange, capture, error, className }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const src = imageSrc(value);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setProblem(undefined);
    try {
      onChange(await uploadImage(file));
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = ""; // lets the same file be chosen again
    }
  }

  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <p className="text-sm font-medium">{label}</p>
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- a stored photo, already shrunk before upload */}
        {src && <img src={src} alt={label} className="h-16 w-16 rounded border object-cover" />}
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/*" capture={capture} className="hidden" aria-label={label} onChange={(e) => pick(e.target.files?.[0])} />
        <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Uploading…" : src ? "Change photo" : "Add photo"}
        </Button>
        {src && !busy && (
          <Button type="button" variant="ghost" className="h-11" onClick={() => onChange("")}>Remove</Button>
        )}
      </div>
      {(problem ?? error) && <p className="text-sm text-destructive">{problem ?? error}</p>}
    </div>
  );
}
