import { plannedTimes } from "./planned-times";

const ist = (iso: string) => new Date(`${iso}+05:30`);

describe("plannedTimes", () => {
  it("dispatch-ready = delivery minus the company's delivery minutes; kitchen-ready = 30 minutes earlier", () => {
    const t = plannedTimes("2026-10-07", "13:00", 60, 30, "Asia/Kolkata");
    expect(t.dispatchReadyAt).toEqual(ist("2026-10-07T12:00:00"));
    expect(t.kitchenReadyAt).toEqual(ist("2026-10-07T11:30:00"));
  });

  it("follows the company's own delivery minutes and the kitchen buffer setting", () => {
    const t = plannedTimes("2026-10-07", "13:00", 90, 45, "Asia/Kolkata");
    expect(t.dispatchReadyAt).toEqual(ist("2026-10-07T11:30:00"));
    expect(t.kitchenReadyAt).toEqual(ist("2026-10-07T10:45:00"));
  });

  it("can cross midnight into the previous day", () => {
    const t = plannedTimes("2026-10-07", "00:30", 60, 30, "Asia/Kolkata");
    expect(t.dispatchReadyAt).toEqual(ist("2026-10-06T23:30:00"));
    expect(t.kitchenReadyAt).toEqual(ist("2026-10-06T23:00:00"));
  });

  it("RF1: gives the same instants whatever time zone the server runs in", () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = "America/Los_Angeles";
      const t = plannedTimes("2026-10-07", "13:00", 60, 30, "Asia/Kolkata");
      expect(t.kitchenReadyAt).toEqual(ist("2026-10-07T11:30:00"));
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it("a delivery time of zero minutes lead time means dispatch-ready equals delivery time", () => {
    const t = plannedTimes("2026-10-07", "13:00", 0, 30, "Asia/Kolkata");
    expect(t.dispatchReadyAt).toEqual(ist("2026-10-07T13:00:00"));
  });
});
