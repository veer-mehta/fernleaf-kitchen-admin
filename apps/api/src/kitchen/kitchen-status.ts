import { UnitStatus } from "@prisma/client";

export type Urgency = "late" | "at_risk" | "ok";

// How worried the kitchen should be about a prep unit, from the time the order's food must be ready.
//   late    - the planned time has passed and the unit is not done
//   at_risk - not done and the planned time is within `atRiskMinutes`
//   ok      - everything else (done units are always ok)
export function urgencyOf(plannedKitchenReadyAt: Date, now: Date, status: UnitStatus, atRiskMinutes = 30): Urgency {
  if (status === "DONE") return "ok";
  const minutesLeft = (plannedKitchenReadyAt.getTime() - now.getTime()) / 60_000;
  if (minutesLeft < 0) return "late";
  if (minutesLeft <= atRiskMinutes) return "at_risk";
  return "ok";
}
