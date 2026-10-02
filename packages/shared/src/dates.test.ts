import { kitchenToday } from "./dates";

// RF 1: the server may run in UTC; "today" must follow the kitchen zone.
describe("kitchenToday", () => {
  it("23:00 UTC is already tomorrow in Kolkata", () => {
    expect(kitchenToday(new Date("2026-10-03T23:00:00Z"), "Asia/Kolkata")).toBe("2026-10-04");
  });
  it("18:00 UTC is 23:30 IST, still the same kitchen date", () => {
    expect(kitchenToday(new Date("2026-10-03T18:00:00Z"), "Asia/Kolkata")).toBe("2026-10-03");
  });
});
