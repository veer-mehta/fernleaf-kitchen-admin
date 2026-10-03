import { KitchenSettings } from "@fernleaf/shared";
import { computeCutoff } from "./cutoff";

// Calendar used below (2026): Thu 1 Oct, Fri 2, Sat 3, Sun 4, Mon 5, Tue 6, Wed 7, Thu 8, Fri 9, Sat 10, Sun 11.
const settings = (over: Partial<KitchenSettings> = {}): KitchenSettings => ({
  timezone: "Asia/Kolkata",
  workingDays: [1, 2, 3, 4, 5],
  cutoffTime: "16:00",
  cutoffWorkingDays: 2,
  kitchenReadyBufferMinutes: 30,
  onTimeGraceMinutes: 0,
  holidays: [],
  ...over,
});
// "16:00 on that date in Kolkata" as an exact instant
const ist = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);

describe("computeCutoff", () => {
  it("assignment example: a Wednesday delivery locks Monday 16:00", () => {
    expect(computeCutoff("2026-10-07", settings())).toEqual(ist("2026-10-05", "16:00"));
  });

  it("skips the weekend: a Monday delivery locks Thursday", () => {
    expect(computeCutoff("2026-10-05", settings())).toEqual(ist("2026-10-01", "16:00"));
  });

  it("skips a kitchen holiday (Tue 6 closed -> Wed 7 locks Fri 2)", () => {
    expect(computeCutoff("2026-10-07", settings({ holidays: ["2026-10-06"] }))).toEqual(ist("2026-10-02", "16:00"));
  });

  it("RF2: consecutive holidays Mon+Tue skip even further back (Thu 1)", () => {
    expect(computeCutoff("2026-10-07", settings({ holidays: ["2026-10-05", "2026-10-06"] }))).toEqual(
      ist("2026-10-01", "16:00"),
    );
  });

  it("RF2: a holiday on the delivery date itself changes nothing (delivery date is never counted)", () => {
    expect(computeCutoff("2026-10-07", settings({ holidays: ["2026-10-07"] }))).toEqual(ist("2026-10-05", "16:00"));
  });

  it("RF2: a delivery on a closed day (Saturday) still counts back from that date: locks Thu 8", () => {
    expect(computeCutoff("2026-10-10", settings())).toEqual(ist("2026-10-08", "16:00"));
  });

  it("RF2: a Sunday delivery locks Thursday 8 as well (Fri 9 = 1, Thu 8 = 2)", () => {
    expect(computeCutoff("2026-10-11", settings())).toEqual(ist("2026-10-08", "16:00"));
  });

  it("a 7-day kitchen week with 1 working day locks the day before, weekends included", () => {
    const s = settings({ workingDays: [1, 2, 3, 4, 5, 6, 7], cutoffWorkingDays: 1 });
    expect(computeCutoff("2026-10-11", s)).toEqual(ist("2026-10-10", "16:00"));
  });

  it("0 working days locks on the delivery date itself at the cut-off time", () => {
    expect(computeCutoff("2026-10-07", settings({ cutoffWorkingDays: 0 }))).toEqual(ist("2026-10-07", "16:00"));
  });

  it("uses the configured cut-off time", () => {
    expect(computeCutoff("2026-10-07", settings({ cutoffTime: "07:30" }))).toEqual(ist("2026-10-05", "07:30"));
  });

  it("the company calendar has no say: only the kitchen settings are inputs", () => {
    // computeCutoff takes nothing about companies; this documents the rule (spec 4.4).
    expect(computeCutoff.length).toBe(2);
  });

  it("refuses to loop forever when the kitchen never works", () => {
    expect(() => computeCutoff("2026-10-07", settings({ workingDays: [] }))).toThrow(/working day/i);
  });

  it("RF1: gives the same answer whatever time zone the server runs in", () => {
    const original = process.env.TZ;
    try {
      for (const tz of ["UTC", "America/Los_Angeles", "Pacific/Auckland"]) {
        process.env.TZ = tz;
        expect(computeCutoff("2026-10-07", settings())).toEqual(ist("2026-10-05", "16:00"));
        expect(computeCutoff("2026-10-05", settings({ holidays: ["2026-10-02"] }))).toEqual(ist("2026-09-30", "16:00"));
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it("works in another kitchen zone too (16:00 in London is not 16:00 in Kolkata)", () => {
    const london = settings({ timezone: "Europe/London" });
    expect(computeCutoff("2026-10-07", london)).toEqual(new Date("2026-10-05T16:00:00+01:00"));
  });
});
