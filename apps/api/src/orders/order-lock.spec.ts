import { DomainError } from "../common/domain-error";
import { assertEditable } from "./order-lock";

const cutoffAt = new Date("2026-10-05T10:30:00Z"); // Mon 16:00 IST
const before = new Date("2026-10-05T10:29:59Z");
const atCutoff = new Date("2026-10-05T10:30:00Z");
const after = new Date("2026-10-06T00:00:00Z");

const order = (status: string, over: { invoiceId?: number | null } = {}) =>
  ({ status, cutoffAt, invoiceId: over.invoiceId ?? null }) as Parameters<typeof assertEditable>[0];

function codeOf(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
}

describe("assertEditable: editing lines", () => {
  it("drafts and placed orders can be edited before the cut-off", () => {
    expect(codeOf(() => assertEditable(order("DRAFT"), "edit", before, false))).toBeNull();
    expect(codeOf(() => assertEditable(order("PLACED"), "edit", before, false))).toBeNull();
  });

  it("the cut-off instant itself is already locked", () => {
    expect(codeOf(() => assertEditable(order("PLACED"), "edit", atCutoff, false))).toBe("CUTOFF_PASSED");
  });

  it("nobody edits lines after the cut-off, not even someone who can override", () => {
    expect(codeOf(() => assertEditable(order("PLACED"), "edit", after, false))).toBe("CUTOFF_PASSED");
    expect(codeOf(() => assertEditable(order("PLACED"), "edit", after, true))).toBe("CUTOFF_PASSED");
  });

  it.each(["CONFIRMED", "DELIVERED", "CANCELLED", "REJECTED"])("a %s order's lines cannot be edited", (status) => {
    expect(codeOf(() => assertEditable(order(status), "edit", before, true))).toBe("ORDER_NOT_EDITABLE");
  });
});

describe("assertEditable: cancelling", () => {
  it("before the cut-off a drafts/placed order can be cancelled by anyone who may write orders", () => {
    expect(codeOf(() => assertEditable(order("DRAFT"), "cancel", before, false))).toBeNull();
    expect(codeOf(() => assertEditable(order("PLACED"), "cancel", before, false))).toBeNull();
  });

  it("after the cut-off only someone who can override may cancel", () => {
    expect(codeOf(() => assertEditable(order("PLACED"), "cancel", after, false))).toBe("CUTOFF_PASSED");
    expect(codeOf(() => assertEditable(order("PLACED"), "cancel", after, true))).toBeNull();
  });

  it("a confirmed order is cancellable only with override rights, whatever the time", () => {
    expect(codeOf(() => assertEditable(order("CONFIRMED"), "cancel", before, false))).toBe("CUTOFF_PASSED");
    expect(codeOf(() => assertEditable(order("CONFIRMED"), "cancel", after, true))).toBeNull();
  });

  it.each(["DELIVERED", "CANCELLED", "REJECTED"])("a %s order cannot be cancelled", (status) => {
    expect(codeOf(() => assertEditable(order(status), "cancel", before, true))).toBe("ORDER_NOT_CANCELLABLE");
  });
});

describe("assertEditable: invoiced orders", () => {
  it("are locked for every kind of change, even for overrides", () => {
    const invoiced = order("CONFIRMED", { invoiceId: 7 });
    expect(codeOf(() => assertEditable(invoiced, "cancel", after, true))).toBe("ORDER_INVOICED");
    expect(codeOf(() => assertEditable(invoiced, "override", after, true))).toBe("ORDER_INVOICED");
    expect(codeOf(() => assertEditable(order("PLACED", { invoiceId: 7 }), "edit", before, true))).toBe("ORDER_INVOICED");
  });
});

describe("assertEditable: admin overrides of delivery details", () => {
  it("allowed on placed and confirmed orders for someone with override rights", () => {
    expect(codeOf(() => assertEditable(order("CONFIRMED"), "override", after, true))).toBeNull();
    expect(codeOf(() => assertEditable(order("PLACED"), "override", after, true))).toBeNull();
  });

  it("refused without override rights, and on finished or cancelled orders", () => {
    expect(codeOf(() => assertEditable(order("CONFIRMED"), "override", after, false))).toBe("CUTOFF_PASSED");
    for (const status of ["DRAFT", "DELIVERED", "CANCELLED", "REJECTED"]) {
      expect(codeOf(() => assertEditable(order(status), "override", after, true))).toBe("ORDER_NOT_EDITABLE");
    }
  });
});
