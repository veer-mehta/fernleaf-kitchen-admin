import { INestApplication } from "@nestjs/common";
import { DEFAULT_SETTINGS } from "@fernleaf/shared";
import { SettingsService } from "../src/settings/settings.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp, loginAs, resetAndSeedAuth } from "./helpers/app";

describe("settings and kitchen holidays (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetAndSeedAuth(prisma);
  });

  it("returns the defaults when nothing has been saved (Asia/Kolkata, Mon-Fri, 16:00, 2 days)", async () => {
    const admin = await loginAs(app, "admin@test.com");
    const res = await admin.get("/settings");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...DEFAULT_SETTINGS, holidays: [] });
  });

  it("saves changes and keeps the other values", async () => {
    const admin = await loginAs(app, "admin@test.com");
    await admin.put("/settings").send({ cutoffTime: "09:30", cutoffWorkingDays: 3 });
    const res = await admin.get("/settings");
    expect(res.body.cutoffTime).toBe("09:30");
    expect(res.body.cutoffWorkingDays).toBe(3);
    expect(res.body.timezone).toBe("Asia/Kolkata");
    expect(res.body.workingDays).toEqual([1, 2, 3, 4, 5]);
  });

  it("the service reads what the API saved", async () => {
    const admin = await loginAs(app, "admin@test.com");
    await admin.put("/settings").send({ workingDays: [1, 2, 3, 4, 5, 6] });
    const settings = await app.get(SettingsService).getKitchenSettings();
    expect(settings.workingDays).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("rejects bad values with field errors", async () => {
    const admin = await loginAs(app, "admin@test.com");
    const res = await admin.put("/settings").send({
      timezone: "Mars/Olympus",
      cutoffTime: "25:00",
      workingDays: [],
      cutoffWorkingDays: -1,
      kitchenReadyBufferMinutes: 1.5,
    });
    expect(res.status).toBe(400);
    for (const field of ["timezone", "cutoffTime", "workingDays", "cutoffWorkingDays", "kitchenReadyBufferMinutes"]) {
      expect(res.body.fields[field]).toBeDefined();
    }
  });

  it("rejects duplicate or out-of-range working days", async () => {
    const admin = await loginAs(app, "admin@test.com");
    expect((await admin.put("/settings").send({ workingDays: [1, 1] })).status).toBe(400);
    expect((await admin.put("/settings").send({ workingDays: [0, 8] })).status).toBe(400);
  });

  describe("kitchen holidays", () => {
    it("adds, lists (sorted by date) and removes holidays", async () => {
      const admin = await loginAs(app, "admin@test.com");
      await admin.post("/kitchen-holidays").send({ date: "2026-12-25", name: "Christmas" });
      const second = await admin.post("/kitchen-holidays").send({ date: "2026-10-02", name: "Gandhi Jayanti" });
      expect(second.status).toBe(201);

      const list = await admin.get("/kitchen-holidays");
      expect(list.body.map((h: { date: string }) => h.date)).toEqual(["2026-10-02", "2026-12-25"]);
      expect((await admin.get("/settings")).body.holidays).toEqual(["2026-10-02", "2026-12-25"]);

      await admin.delete(`/kitchen-holidays/${second.body.id}`).expect(200);
      expect((await admin.get("/kitchen-holidays")).body).toHaveLength(1);
    });

    it("rejects a duplicate date, a malformed date and a date that does not exist", async () => {
      const admin = await loginAs(app, "admin@test.com");
      await admin.post("/kitchen-holidays").send({ date: "2026-10-02" });
      const dup = await admin.post("/kitchen-holidays").send({ date: "2026-10-02" });
      expect(dup.status).toBe(409);
      expect(dup.body.fields.date).toBeDefined();
      expect((await admin.post("/kitchen-holidays").send({ date: "02/10/2026" })).status).toBe(400);
      expect((await admin.post("/kitchen-holidays").send({ date: "2026-02-31" })).status).toBe(400);
    });

    it("deleting an unknown holiday is 404", async () => {
      const admin = await loginAs(app, "admin@test.com");
      expect((await admin.delete("/kitchen-holidays/999")).status).toBe(404);
    });
  });

  it("only admin may read or change settings", async () => {
    for (const who of ["kitchen@test.com", "dispatch@test.com", "driver@test.com"]) {
      const agent = await loginAs(app, who);
      expect((await agent.get("/settings")).status).toBe(403);
      expect((await agent.put("/settings").send({ cutoffTime: "10:00" })).status).toBe(403);
      expect((await agent.post("/kitchen-holidays").send({ date: "2026-10-02" })).status).toBe(403);
    }
  });
});
