// A small labelled number. `hint` says exactly how the number is worked out.
export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: "bad" | "warn" }) {
  const color = tone === "bad" ? "text-destructive" : tone === "warn" ? "text-amber-600" : "";
  return (
    <div className="rounded-md border p-3" title={hint}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-semibold ${color}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
