import { urgencyOf } from "./kitchen-status";

const planned = new Date("2026-10-07T06:00:00Z"); // 11:30 IST: the time the kitchen must be ready
const minutesBefore = (m: number) => new Date(planned.getTime() - m * 60_000);
const minutesAfter = (m: number) => new Date(planned.getTime() + m * 60_000);

describe("urgencyOf", () => {
  it("is ok when there is plenty of time", () => {
    expect(urgencyOf(planned, minutesBefore(120), "PENDING")).toBe("ok");
    expect(urgencyOf(planned, minutesBefore(31), "STARTED")).toBe("ok");
  });

  it("is at risk within 30 minutes of the planned time, including exactly 30", () => {
    expect(urgencyOf(planned, minutesBefore(30), "PENDING")).toBe("at_risk");
    expect(urgencyOf(planned, minutesBefore(10), "STARTED")).toBe("at_risk");
    expect(urgencyOf(planned, planned, "PENDING")).toBe("at_risk"); // at the deadline itself: not yet late
  });

  it("is late once the planned time has passed", () => {
    expect(urgencyOf(planned, minutesAfter(1), "PENDING")).toBe("late");
    expect(urgencyOf(planned, minutesAfter(240), "STARTED")).toBe("late");
  });

  it("finished work is always ok, however late it was", () => {
    expect(urgencyOf(planned, minutesAfter(240), "DONE")).toBe("ok");
    expect(urgencyOf(planned, minutesBefore(5), "DONE")).toBe("ok");
  });

  it("the at-risk window can be changed", () => {
    expect(urgencyOf(planned, minutesBefore(45), "PENDING", 60)).toBe("at_risk");
    expect(urgencyOf(planned, minutesBefore(45), "PENDING", 15)).toBe("ok");
  });
});
