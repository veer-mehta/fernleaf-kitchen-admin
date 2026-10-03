import { DomainError } from "../common/domain-error";
import { assertTransition, stageOf, type Stage } from "./dispatch-transitions";

const order = (over: Partial<Parameters<typeof stageOf>[0]> = {}) => ({
  status: "CONFIRMED" as const,
  kitchenReadyAt: null,
  dispatchReadyAt: null,
  outForDeliveryAt: null,
  deliveredAt: null,
  ...over,
});
const at = new Date("2026-10-07T06:00:00Z");

function code(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
}

describe("stageOf", () => {
  it("follows the timestamps: cooking -> kitchen ready -> dispatch ready -> out for delivery -> delivered", () => {
    expect(stageOf(order())).toBe("COOKING");
    expect(stageOf(order({ kitchenReadyAt: at }))).toBe("KITCHEN_READY");
    expect(stageOf(order({ kitchenReadyAt: at, dispatchReadyAt: at }))).toBe("DISPATCH_READY");
    expect(stageOf(order({ kitchenReadyAt: at, dispatchReadyAt: at, outForDeliveryAt: at }))).toBe("OUT_FOR_DELIVERY");
    expect(stageOf(order({ status: "DELIVERED", kitchenReadyAt: at, dispatchReadyAt: at, outForDeliveryAt: at, deliveredAt: at }))).toBe("DELIVERED");
  });

  it("orders that are not live (draft, placed, cancelled, rejected) have no dispatch stage", () => {
    for (const status of ["DRAFT", "PLACED", "CANCELLED", "REJECTED"] as const) {
      expect(stageOf(order({ status }))).toBeNull();
    }
  });
});

describe("assertTransition", () => {
  const allowed: [Stage, Stage][] = [
    ["KITCHEN_READY", "DISPATCH_READY"],
    ["DISPATCH_READY", "OUT_FOR_DELIVERY"],
    ["OUT_FOR_DELIVERY", "DELIVERED"],
  ];
  it.each(allowed)("%s -> %s is allowed", (from, to) => {
    expect(code(() => assertTransition(from, to))).toBeNull();
  });

  it("each step needs the previous one: no skipping ahead", () => {
    expect(code(() => assertTransition("KITCHEN_READY", "OUT_FOR_DELIVERY"))).toBe("INVALID_TRANSITION");
    expect(code(() => assertTransition("KITCHEN_READY", "DELIVERED"))).toBe("INVALID_TRANSITION");
    expect(code(() => assertTransition("DISPATCH_READY", "DELIVERED"))).toBe("INVALID_TRANSITION");
  });

  it("a step cannot be repeated", () => {
    for (const stage of ["KITCHEN_READY", "DISPATCH_READY", "OUT_FOR_DELIVERY", "DELIVERED"] as Stage[]) {
      expect(code(() => assertTransition(stage, stage))).toBe("INVALID_TRANSITION");
    }
  });

  it("nothing goes backwards", () => {
    expect(code(() => assertTransition("OUT_FOR_DELIVERY", "DISPATCH_READY"))).toBe("INVALID_TRANSITION");
    expect(code(() => assertTransition("DELIVERED", "KITCHEN_READY"))).toBe("INVALID_TRANSITION");
  });

  it("an order still being cooked cannot move on, and says why", () => {
    expect(code(() => assertTransition("COOKING", "DISPATCH_READY"))).toBe("ORDERS_NOT_READY");
  });
});
