import { INestApplication } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { DemoService } from "../src/demo/demo.service";
import { createTestApp, FakeClock, loginAs, resetAndSeedAuth } from "./helpers/app";

// The review day is not known in advance, and the data is rebuilt by the first check after midnight. Check that on every
// kind of day (each weekday, month end, year end, a leap day) every role has something real to see.
const DAYS = [
  ...Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2026, 9, 4 + i)).toISOString().slice(0, 10)),
  "2026-10-31", "2026-12-31", "2028-02-29",
];

describe("demo data on every kind of day (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let clock: FakeClock;

  beforeAll(async () => {
    ({ app, prisma, clock } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });

  it.each(DAYS)("%s: the midnight refresh leaves every role with work to see", async (day) => {
    await resetAndSeedAuth(prisma);
    clock.set(`${day}T00:05:00+05:30`); // just after midnight in the kitchen zone
    const built = await app.get(DemoService).ensureToday();
    expect(built?.today).toBe(day);

    const driver = await loginAs(app, "driver@test.com");
    const drops = (await driver.get("/driver/drops")).body.drops as { deliveryTime: string; status: string }[];
    expect(drops.length).toBeGreaterThanOrEqual(3);
    expect(new Set(drops.map((d) => d.status)).size).toBeGreaterThanOrEqual(2); // not all in the same state
    expect(drops.some((d) => d.status === "OUT_FOR_DELIVERY")).toBe(true); // something the driver can mark delivered

    const board = (await (await loginAs(app, "kitchen@test.com")).get("/kitchen/board")).body.totals;
    expect(board.pending).toBeGreaterThan(0);
    expect(board.done).toBeGreaterThan(0);

    const dispatch = (await (await loginAs(app, "dispatch@test.com")).get("/dispatch/board")).body;
    expect(dispatch.drops.length).toBeGreaterThanOrEqual(3);

    const dash = (await (await loginAs(app, "admin@test.com")).get("/dashboard/admin")).body;
    expect(dash.date).toBe(day);
    expect(dash.activeOrders).toBeGreaterThan(0);
  }, 60000);
});
