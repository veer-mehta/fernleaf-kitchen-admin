import { Badge } from "@/components/ui/badge";
import type { Urgency } from "@/lib/types";

// Late work is red and at-risk work is amber, so the board can be scanned at a glance.
export function UrgencyBadge({ urgency }: { urgency: Urgency }) {
  if (urgency === "late") return <Badge variant="destructive">Late</Badge>;
  if (urgency === "at_risk") return <Badge className="bg-amber-500 text-white hover:bg-amber-500">At risk</Badge>;
  return null;
}
