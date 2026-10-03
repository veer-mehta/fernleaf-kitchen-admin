import { INestApplication } from "@nestjs/common";
import { CutoffProcessor } from "../src/orders/cutoff-processor.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp, FakeClock, loginAs, resetAndSeedAuth } from "./helpers/app";
import { AFTER_CUTOFF, BEFORE_CUTOFF, DELIVERY_DATE, TEN_BOWLS_TOTAL, orderWorld, tenBowls, type OrderWorld } from "./helpers/order-world";

describe("dashboards (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let clock: FakeClock;
  let processor: CutoffProcessor;

  beforeAll(async () => {
    ({ app, prisma, clock } = await createTestApp());
    processor = app.get(CutoffProcessor);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetAndSeedAuth(prisma);
    clock.set(BEFORE_CUTOFF);
  });

  type Agent = Awaited<ReturnType<typeof loginAs>>;
  const place = async (admin: Agent, w: OrderWorld, over: Record<string, unknown> = {}) => {
    const res = await admin.post("/orders").send(tenBowls(w, over));
    if (res.status !== 201) throw new Error(JSON.stringify(res.body));
    return res.body.id as number;
  };
  const NOON = "2026-10-07T12:00:00+05:30";

  describe("admin dashboard", () => {
    it("counts the chosen day's orders by status, every status listed (zero when none)", async () => {
      const w = await orderWorld(prisma);
      const admin = await loginAs(app, "admin@test.com");
      const a = await place(admin, w);
      await place(admin, w);
      await place(admin, w, { status: "DRAFT" });
      const cancelled = await place(admin, w);
      await admin.post(`/orders/${cancelled}/cancel`).send({});
      const rejected = await place(admin, w);
      await admin.post(`/orders/${rejected}/reject`).send({ reason: "no" });
      void a;

      const res = await admin.get(`/dashboard/admin?date=${DELIVERY_DATE}`);
      expect(res.status).toBe(200);
      expect(res.body.date).toBe(DELIVERY_DATE);
      expect(res.body.ordersByStatus).toEqual({ DRAFT: 1, PLACED: 2, CONFIRMED: 0, DELIVERED: 0, CANCELLED: 1, REJECTED: 1 });
      // cancelled and rejected orders are not counted as active
      expect(res.body.activeOrders).toBe(3);
      expect(res.body.activeValueCents).toBe(3 * TEN_BOWLS_TOTAL);
    });

    it("defaults to today in the kitchen zone", async () => {
      const w = await orderWorld(prisma);
      const admin = await loginAs(app, "admin@test.com");
      await place(admin, w);
      clock.set("2026-10-06T22:00:00Z"); // 03:30 IST on the 7th
      const res = await admin.get("/dashboard/admin");
      expect(res.body.date).toBe(DELIVERY_DATE);
    });

    it("shows confirmed-but-uninvoiced value per company, ignoring cancelled and invoiced orders", async () => {
      const w = await orderWorld(prisma);
      const beta = await w.f.company({ name: "Beta Foods" });
      await w.f.domain(beta.id, "beta.com");
      await w.f.address(beta.id);
      const ben = await w.f.employee(beta.id, "ben@beta.com");
      const admin = await loginAs(app, "admin@test.com");
      const acme1 = await place(admin, w);
      const acme2 = await place(admin, w);
      await place(admin, w, { employeeId: ben.id });
      clock.set(AFTER_CUTOFF);
      await processor.processDate(DELIVERY_DATE);
      await admin.post("/invoices").send({ companyId: w.company.id, orderIds: [acme1] }).expect(201);
      await admin.post(`/orders/${acme2}/cancel`).send({}).expect(201);

      const res = await admin.get(`/dashboard/admin?date=${DELIVERY_DATE}`);
      expect(res.body.uninvoiced.totalCents).toBe(TEN_BOWLS_TOTAL); // only Beta's order is left
      expect(res.body.uninvoiced.orderCount).toBe(1);
      expect(res.body.uninvoiced.companies).toEqual([{ companyId: beta.id, companyName: "Beta Foods", orderCount: 1, totalCents: TEN_BOWLS_TOTAL }]);
    });

    it("counts the upcoming week (today and the next 6 days), day by day, without cancelled or rejected", async () => {
      const w = await orderWorld(prisma);
      const admin = await loginAs(app, "admin@test.com");
      await place(admin, w); // Wed 7 Oct
      await place(admin, w);
      await place(admin, w, { deliveryDate: "2026-10-08" });
      const cancelled = await place(admin, w, { deliveryDate: "2026-10-08" });
      await admin.post(`/orders/${cancelled}/cancel`).send({});
      await place(admin, w, { deliveryDate: "2026-10-14" }); // 7 days later: outside the window

      clock.set("2026-10-07T09:00:00+05:30"); // "today" is Wed 7 Oct (cut-offs for 7th have passed, but orders exist)
      const res = await admin.get("/dashboard/admin");
      expect(res.body.upcoming.from).toBe("2026-10-07");
      expect(res.body.upcoming.to).toBe("2026-10-13");
      expect(res.body.upcoming.days).toHaveLength(7);
      expect(res.body.upcoming.days.slice(0, 2)).toEqual([{ date: "2026-10-07", count: 2 }, { date: "2026-10-08", count: 1 }]);
      expect(res.body.upcoming.total).toBe(3);
    });

    it("lists the dishes and options missing a price, per tier", async () => {
      const w = await orderWorld(prisma);
      const enterprise = await w.f.tier("Enterprise"); // no prices at all: 1 dish + 2 options missing
      const extra = await w.f.dish("EXTRA"); // unpriced on Standard too
      await w.f.dish("OFF", { active: false }); // inactive dishes do not count
      void extra;
      const admin = await loginAs(app, "admin@test.com");
      const res = await admin.get("/dashboard/admin");
      const byName = Object.fromEntries(res.body.missingPrices.tiers.map((t: { name: string }) => [t.name, t]));
      expect(byName["Standard"]).toMatchObject({ dishes: 1, options: 0 }); // only EXTRA
      expect(byName["Enterprise"]).toMatchObject({ tierId: enterprise.id, dishes: 2, options: 2 });
      expect(res.body.missingPrices.total).toBe(5);
    });

    it("only admin can see it", async () => {
      for (const who of ["kitchen@test.com", "dispatch@test.com", "driver@test.com"]) {
        expect((await (await loginAs(app, who)).get("/dashboard/admin")).status).toBe(403);
      }
    });
  });

  describe("kitchen dashboard", () => {
    async function confirmedDay() {
      const w = await orderWorld(prisma);
      const station = await prisma.kitchenStation.create({ data: { name: "Hot line" } });
      await prisma.dish.update({ where: { id: w.dish.id }, data: { stationId: station.id } });
      const admin = await loginAs(app, "admin@test.com");
      const first = await place(admin, w);
      const second = await place(admin, w);
      clock.set(AFTER_CUTOFF);
      await processor.processDate(DELIVERY_DATE);
      const kitchen = await loginAs(app, "kitchen@test.com");
      const units = await prisma.prepUnit.findMany({ orderBy: { id: "asc" } });
      return { w, admin, kitchen, first, second, units };
    }

    it("counts today's units by station and status", async () => {
      const { kitchen, units } = await confirmedDay();
      clock.set("2026-10-07T09:00:00+05:30");
      await kitchen.post(`/kitchen/units/${units[0].id}/start`);
      await kitchen.post(`/kitchen/units/${units[1].id}/done`);
      const res = await kitchen.get(`/dashboard/kitchen?date=${DELIVERY_DATE}`);
      expect(res.status).toBe(200);
      expect(res.body.totals).toMatchObject({ pending: 2, started: 1, done: 1 });
      expect(res.body.stations).toEqual([{ stationId: expect.any(Number), name: "Hot line", counts: { pending: 2, started: 1, done: 1 } }]);
    });

    it("counts late and at-risk units and lists the next deadlines, nearest first, only for unfinished orders", async () => {
      const { kitchen, units, first } = await confirmedDay();
      clock.set("2026-10-07T11:10:00+05:30"); // 20 minutes before the 11:30 deadline
      let res = await kitchen.get(`/dashboard/kitchen?date=${DELIVERY_DATE}`);
      expect(res.body.totals).toMatchObject({ late: 0, atRisk: 4 });
      expect(res.body.nextDeadlines).toHaveLength(2);
      expect(res.body.nextDeadlines[0]).toMatchObject({ unitsLeft: 2, urgency: "at_risk", companyName: "Acme" });
      expect(new Date(res.body.nextDeadlines[0].plannedKitchenReadyAt)).toEqual(new Date("2026-10-07T11:30:00+05:30"));

      for (const u of units.slice(0, 2)) await kitchen.post(`/kitchen/units/${u.id}/done`); // the first order is finished
      clock.set("2026-10-07T11:40:00+05:30");
      res = await kitchen.get(`/dashboard/kitchen?date=${DELIVERY_DATE}`);
      expect(res.body.totals).toMatchObject({ late: 2, atRisk: 0, done: 2 });
      expect(res.body.nextDeadlines.map((d: { orderId: number }) => d.orderId)).not.toContain(first);
      expect(res.body.nextDeadlines).toHaveLength(1);
    });

    it("is empty and calm when there is nothing to cook", async () => {
      const kitchen = await loginAs(app, "kitchen@test.com");
      const res = await kitchen.get("/dashboard/kitchen");
      expect(res.body.totals).toEqual({ pending: 0, started: 0, done: 0, late: 0, atRisk: 0 });
      expect(res.body.nextDeadlines).toEqual([]);
    });

    it("kitchen and admin only", async () => {
      for (const who of ["dispatch@test.com", "driver@test.com"]) {
        expect((await (await loginAs(app, who)).get("/dashboard/kitchen")).status).toBe(403);
      }
    });
  });

  describe("dispatch dashboard", () => {
    async function drops(times: string[], kitchenReady = true) {
      const w = await orderWorld(prisma, { canChangeTime: true });
      const driver = await prisma.staff.findUniqueOrThrow({ where: { email: "driver@test.com" } });
      const admin = await loginAs(app, "admin@test.com");
      const ids: number[] = [];
      for (const deliveryTime of times) ids.push(await place(admin, w, { deliveryTime }));
      clock.set(AFTER_CUTOFF);
      await processor.processDate(DELIVERY_DATE);
      if (kitchenReady) for (const id of ids) await admin.post(`/orders/${id}/force-complete`);
      const dropIds = await Promise.all(ids.map(async (id) => (await prisma.order.findUniqueOrThrow({ where: { id } })).dropId!));
      const dispatch = await loginAs(app, "dispatch@test.com");
      return { w, admin, dispatch, ids, dropIds, driver };
    }

    it("shows drops by status, those without a driver, and late ones", async () => {
      const { dispatch, dropIds, driver } = await drops(["13:00", "15:00", "17:00"]);
      await prisma.drop.update({ where: { id: dropIds[0] }, data: { driverId: driver.id } });
      clock.set("2026-10-07T13:30:00+05:30");
      const res = await dispatch.get(`/dashboard/dispatch?date=${DELIVERY_DATE}`);
      expect(res.status).toBe(200);
      expect(res.body.totals).toMatchObject({ open: 3, delivered: 0, unassigned: 2, late: 1 });
      expect(res.body.lateDrops).toEqual([expect.objectContaining({ id: dropIds[0], deliveryTime: "13:00", company: "Acme" })]);
    });

    it("the on-time rate is delivered-on-time over delivered, and is null (not 0%) when nothing was delivered", async () => {
      const { dispatch, dropIds, driver } = await drops(["13:00", "15:00"]);
      let res = await dispatch.get(`/dashboard/dispatch?date=${DELIVERY_DATE}`);
      expect(res.body.onTime).toEqual({ delivered: 0, onTime: 0, late: 0, ratePercent: null });

      for (const id of dropIds) await prisma.drop.update({ where: { id }, data: { driverId: driver.id } });
      clock.set("2026-10-07T12:00:00+05:30");
      for (const id of dropIds) {
        await dispatch.post(`/drops/${id}/dispatch-ready`).expect(201);
        await dispatch.post(`/drops/${id}/out-for-delivery`).expect(201);
      }
      clock.set("2026-10-07T12:55:00+05:30");
      await dispatch.post(`/drops/${dropIds[0]}/delivered`).send({}).expect(201); // on time for 13:00
      clock.set("2026-10-07T15:20:00+05:30");
      await dispatch.post(`/drops/${dropIds[1]}/delivered`).send({}).expect(201); // late for 15:00
      res = await dispatch.get(`/dashboard/dispatch?date=${DELIVERY_DATE}`);
      expect(res.body.onTime).toEqual({ delivered: 2, onTime: 1, late: 1, ratePercent: 50 });
      expect(res.body.totals.delivered).toBe(2);
    });

    it("dispatch and admin only", async () => {
      for (const who of ["kitchen@test.com", "driver@test.com"]) {
        expect((await (await loginAs(app, who)).get("/dashboard/dispatch")).status).toBe(403);
      }
    });
  });

  describe("driver dashboard", () => {
    it("lists only the driver's own drops today, in time order, with counts", async () => {
      const w = await orderWorld(prisma, { canChangeTime: true });
      const driverStaff = await prisma.staff.findUniqueOrThrow({ where: { email: "driver@test.com" } });
      const admin = await loginAs(app, "admin@test.com");
      const ids = [await place(admin, w, { deliveryTime: "15:00" }), await place(admin, w, { deliveryTime: "13:00" }), await place(admin, w, { deliveryTime: "14:00" })];
      clock.set(AFTER_CUTOFF);
      await processor.processDate(DELIVERY_DATE);
      const dropIds = await Promise.all(ids.map(async (id) => (await prisma.order.findUniqueOrThrow({ where: { id } })).dropId!));
      await prisma.drop.update({ where: { id: dropIds[0] }, data: { driverId: driverStaff.id } });
      await prisma.drop.update({ where: { id: dropIds[1] }, data: { driverId: driverStaff.id } });
      // the 14:00 drop belongs to nobody the driver can see

      clock.set(NOON);
      const driver = await loginAs(app, "driver@test.com");
      const res = await driver.get("/dashboard/driver");
      expect(res.status).toBe(200);
      expect(res.body.drops.map((d: { deliveryTime: string }) => d.deliveryTime)).toEqual(["13:00", "15:00"]);
      expect(res.body.counts).toEqual({ total: 2, delivered: 0, remaining: 2 });
      expect(res.body.drops[0]).toMatchObject({ company: "Acme", status: "OPEN" });
    });

    it("drivers (and admin) only", async () => {
      for (const who of ["kitchen@test.com", "dispatch@test.com"]) {
        expect((await (await loginAs(app, who)).get("/dashboard/driver")).status).toBe(403);
      }
    });
  });
});
