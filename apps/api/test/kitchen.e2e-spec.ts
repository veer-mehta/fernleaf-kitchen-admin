import { INestApplication } from "@nestjs/common";
import { KitchenService } from "../src/kitchen/kitchen.service";
import { CutoffProcessor } from "../src/orders/cutoff-processor.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp, FakeClock, loginAs, resetAndSeedAuth } from "./helpers/app";
import { AFTER_CUTOFF, BEFORE_CUTOFF, DELIVERY_DATE, orderWorld, tenBowls, type OrderWorld } from "./helpers/order-world";

describe("kitchen board and prep units (e2e)", () => {
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

  // Makes two requests really run at the same time: each one waits at the start of the service
  // until BOTH have arrived, then they are released together. Without this, one request often
  // finishes before the other begins and a "simultaneous" test proves nothing.
  function holdUntilBothArrive() {
    const service = app.get(KitchenService) as unknown as { orderIdOf: (id: number) => Promise<number> };
    const original = service.orderIdOf.bind(service);
    let arrived = 0;
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    return jest.spyOn(service, "orderIdOf").mockImplementation(async (id: number) => {
      if (++arrived >= 2) open();
      await gate;
      return original(id);
    });
  }
  const place = async (admin: Agent, w: OrderWorld, over: Record<string, unknown> = {}) => {
    const res = await admin.post("/orders").send(tenBowls(w, over));
    if (res.status !== 201) throw new Error(JSON.stringify(res.body));
    return res.body as { id: number };
  };
  const unitsOf = async (orderId: number) =>
    (await prisma.prepUnit.findMany({ where: { combination: { line: { orderId } } }, orderBy: { id: "asc" } })).map((u) => u.id);
  const unit = (id: number) => prisma.prepUnit.findUniqueOrThrow({ where: { id } });
  const order = (id: number) => prisma.order.findUniqueOrThrow({ where: { id } });

  // A confirmed order for Wed 7 Oct with two prep units (6 brown + 4 jeera).
  async function confirmed(opts: { station?: string } = {}) {
    const w = await orderWorld(prisma);
    if (opts.station) {
      const station = await prisma.kitchenStation.create({ data: { name: opts.station } });
      await prisma.dish.update({ where: { id: w.dish.id }, data: { stationId: station.id } });
    }
    const admin = await loginAs(app, "admin@test.com");
    const o = await place(admin, w);
    clock.set(AFTER_CUTOFF);
    await processor.processDate(DELIVERY_DATE);
    const kitchen = await loginAs(app, "kitchen@test.com");
    return { w, admin, kitchen, orderId: o.id, units: await unitsOf(o.id) };
  }

  describe("board", () => {
    it("lists confirmed orders' units grouped by station, with what the cook needs to know", async () => {
      const { kitchen, units, orderId } = await confirmed({ station: "Hot line" });
      const res = await kitchen.get(`/kitchen/board?date=${DELIVERY_DATE}`);
      expect(res.status).toBe(200);
      expect(res.body.stations).toHaveLength(1);
      const station = res.body.stations[0];
      expect(station).toMatchObject({ name: "Hot line", counts: { pending: 2, started: 0, done: 0 } });
      expect(station.units).toHaveLength(2);
      expect(station.units[0]).toMatchObject({
        unitId: units[0],
        orderId,
        dishName: "Dish BOWL",
        optionsSummary: "Brown rice",
        quantity: 6,
        status: "PENDING",
        companyName: "Acme",
        deliveryTime: "13:00",
        urgency: "ok",
      });
      expect(station.units[1]).toMatchObject({ optionsSummary: "Jeera rice", quantity: 4 });
      expect(res.body.totals).toEqual({ pending: 2, started: 0, done: 0, late: 0, atRisk: 0 });
    });

    it("a dish with no station goes under Unassigned, listed last", async () => {
      const w = await orderWorld(prisma);
      const grill = await prisma.kitchenStation.create({ data: { name: "Grill" } });
      const other = await w.f.dish("KEBAB");
      await prisma.dish.update({ where: { id: other.id }, data: { stationId: grill.id } });
      await w.f.dishPrice(w.standard.id, other.id, 500);
      await w.f.categoryItem(w.category.id, other.id);
      const admin = await loginAs(app, "admin@test.com");
      await place(admin, w); // Dish BOWL: no station
      await place(admin, w, { lines: [{ dishId: other.id, quantity: 3, combinations: [{ quantity: 3, selections: [] }] }] });
      clock.set(AFTER_CUTOFF);
      await processor.processDate(DELIVERY_DATE);

      const res = await (await loginAs(app, "kitchen@test.com")).get(`/kitchen/board?date=${DELIVERY_DATE}`);
      expect(res.body.stations.map((s: { name: string }) => s.name)).toEqual(["Grill", "Unassigned"]);
      expect(res.body.stations[1].stationId).toBeNull();
    });

    it("filters by station, including 'none' for Unassigned", async () => {
      const { kitchen } = await confirmed({ station: "Hot line" });
      const station = await prisma.kitchenStation.findFirstOrThrow();
      expect((await kitchen.get(`/kitchen/board?date=${DELIVERY_DATE}&stationId=${station.id}`)).body.stations).toHaveLength(1);
      expect((await kitchen.get(`/kitchen/board?date=${DELIVERY_DATE}&stationId=none`)).body.stations).toHaveLength(0);
      expect((await kitchen.get(`/kitchen/board?date=${DELIVERY_DATE}&stationId=abc`)).status).toBe(400);
    });

    it("only confirmed orders appear: not placed, not cancelled, not other dates", async () => {
      const w = await orderWorld(prisma);
      const admin = await loginAs(app, "admin@test.com");
      const cancelled = await place(admin, w);
      const live = await place(admin, w);
      await place(admin, w, { deliveryDate: "2026-10-14" });
      clock.set(AFTER_CUTOFF);
      await processor.processDate(DELIVERY_DATE);
      await admin.post(`/orders/${cancelled.id}/cancel`).send({});

      const kitchen = await loginAs(app, "kitchen@test.com");
      const res = await kitchen.get(`/kitchen/board?date=${DELIVERY_DATE}`);
      const orderIds = new Set(res.body.stations.flatMap((s: { units: { orderId: number }[] }) => s.units.map((u) => u.orderId)));
      expect([...orderIds]).toEqual([live.id]);
      expect((await kitchen.get("/kitchen/board?date=2026-10-14")).body.stations).toEqual([]); // placed, not yet confirmed
    });

    it("defaults to today in the kitchen zone, whatever the server's zone", async () => {
      const { kitchen } = await confirmed();
      // 22:00 UTC on Tue 6 Oct is already Wed 7 Oct 03:30 in Kolkata.
      clock.set("2026-10-06T22:00:00Z");
      expect((await kitchen.get("/kitchen/board")).body.date).toBe(DELIVERY_DATE);
      clock.set("2026-10-06T17:00:00Z"); // 22:30 IST on the 6th
      expect((await kitchen.get("/kitchen/board")).body.date).toBe("2026-10-06");
    });

    it("processes cut-offs that are due when it loads (no background job needed)", async () => {
      const w = await orderWorld(prisma);
      const admin = await loginAs(app, "admin@test.com");
      await place(admin, w);
      clock.set(AFTER_CUTOFF); // nobody called the processor
      const res = await (await loginAs(app, "kitchen@test.com")).get(`/kitchen/board?date=${DELIVERY_DATE}`);
      expect(res.body.totals.pending).toBe(2);
    });

    it("makes late and at-risk work obvious", async () => {
      const { kitchen, units } = await confirmed();
      // The kitchen must be ready by 11:30 IST on the 7th.
      clock.set("2026-10-07T10:00:00+05:30");
      expect((await kitchen.get(`/kitchen/board?date=${DELIVERY_DATE}`)).body.totals).toMatchObject({ late: 0, atRisk: 0 });
      clock.set("2026-10-07T11:10:00+05:30");
      expect((await kitchen.get(`/kitchen/board?date=${DELIVERY_DATE}`)).body.totals).toMatchObject({ late: 0, atRisk: 2 });
      clock.set("2026-10-07T11:31:00+05:30");
      let res = await kitchen.get(`/kitchen/board?date=${DELIVERY_DATE}`);
      expect(res.body.totals).toMatchObject({ late: 2, atRisk: 0 });
      expect(res.body.stations[0].units[0].urgency).toBe("late");

      await kitchen.post(`/kitchen/units/${units[0]}/done`);
      res = await kitchen.get(`/kitchen/board?date=${DELIVERY_DATE}`);
      expect(res.body.totals).toMatchObject({ late: 1, done: 1 });
    });

    it("stays fast for a busy day (400 orders)", async () => {
      const w = await orderWorld(prisma);
      const base = {
        companyId: w.company.id, employeeId: w.employee.id, deliveryDate: new Date(`${DELIVERY_DATE}T00:00:00Z`), deliveryTime: "13:00",
        addressId: w.hq.id, packaging: "STANDARD" as const, status: "CONFIRMED" as const, cutoffAt: new Date("2026-10-05T10:30:00Z"),
        plannedDispatchReadyAt: new Date("2026-10-07T06:30:00Z"), plannedKitchenReadyAt: new Date("2026-10-07T06:00:00Z"),
        totalCents: 10200, requestJson: {},
      };
      await prisma.order.createMany({ data: Array.from({ length: 400 }, () => base) });
      const orders = await prisma.order.findMany({ select: { id: true } });
      await prisma.orderLine.createMany({
        data: orders.map((o) => ({ orderId: o.id, dishId: w.dish.id, dishNameSnapshot: "Dish BOWL", skuSnapshot: "BOWL", quantity: 10 })),
      });
      const lines = await prisma.orderLine.findMany({ select: { id: true } });
      await prisma.orderLineCombination.createMany({
        data: lines.flatMap((l) => [6, 4].map((q, i) => ({ lineId: l.id, quantity: q, optionsSnapshot: [], unitPriceCents: 1000, lineTotalCents: q * 1000, displayOrder: i }))),
      });
      const combos = await prisma.orderLineCombination.findMany({ select: { id: true } });
      await prisma.prepUnit.createMany({ data: combos.map((c) => ({ combinationId: c.id })) });

      const kitchen = await loginAs(app, "kitchen@test.com");
      const started = Date.now();
      const res = await kitchen.get(`/kitchen/board?date=${DELIVERY_DATE}`);
      const ms = Date.now() - started;
      expect(res.status).toBe(200);
      expect(res.body.totals.pending).toBe(800);
      expect(ms).toBeLessThan(2000);
    });
  });

  describe("starting a unit", () => {
    it("moves it to started, stamps the time, and starts the order's kitchen clock", async () => {
      const { kitchen, units, orderId } = await confirmed();
      clock.set("2026-10-07T09:00:00+05:30");
      const res = await kitchen.post(`/kitchen/units/${units[0]}/start`);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ unitId: units[0], status: "STARTED" });
      const u = await unit(units[0]);
      expect(u.status).toBe("STARTED");
      expect(u.startedAt).toEqual(new Date("2026-10-07T09:00:00+05:30"));
      expect(u.version).toBe(1);
      expect((await order(orderId)).kitchenStartedAt).toEqual(new Date("2026-10-07T09:00:00+05:30"));
    });

    it("the order's kitchen-started time is its FIRST unit's start and does not move", async () => {
      const { kitchen, units, orderId } = await confirmed();
      clock.set("2026-10-07T09:00:00+05:30");
      await kitchen.post(`/kitchen/units/${units[0]}/start`);
      clock.set("2026-10-07T09:20:00+05:30");
      await kitchen.post(`/kitchen/units/${units[1]}/start`);
      expect((await order(orderId)).kitchenStartedAt).toEqual(new Date("2026-10-07T09:00:00+05:30"));
      expect(await prisma.orderEvent.count({ where: { orderId, type: "KITCHEN_STARTED" } })).toBe(1);
    });

    it("a unit cannot be started twice", async () => {
      const { kitchen, units } = await confirmed();
      await kitchen.post(`/kitchen/units/${units[0]}/start`).expect(201);
      const again = await kitchen.post(`/kitchen/units/${units[0]}/start`);
      expect(again.status).toBe(409);
      expect(again.body.code).toBe("UNIT_ALREADY_STARTED");
      expect((await unit(units[0])).version).toBe(1);
    });

    it("RF4: two people starting the same unit at the same moment: exactly one wins", async () => {
      const { kitchen, units } = await confirmed();
      const other = await loginAs(app, "admin@test.com");
      const hold = holdUntilBothArrive();
      const results = await Promise.all([kitchen.post(`/kitchen/units/${units[0]}/start`), other.post(`/kitchen/units/${units[0]}/start`)]);
      hold.mockRestore();
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect((await unit(units[0])).version).toBe(1); // changed once, not twice
    });
  });

  describe("finishing a unit", () => {
    it("moves a started unit to done and stamps the time", async () => {
      const { kitchen, units } = await confirmed();
      clock.set("2026-10-07T09:00:00+05:30");
      await kitchen.post(`/kitchen/units/${units[0]}/start`);
      clock.set("2026-10-07T09:30:00+05:30");
      const res = await kitchen.post(`/kitchen/units/${units[0]}/done`);
      expect(res.status).toBe(201);
      const u = await unit(units[0]);
      expect(u).toMatchObject({ status: "DONE", version: 2 });
      expect(u.startedAt).toEqual(new Date("2026-10-07T09:00:00+05:30"));
      expect(u.doneAt).toEqual(new Date("2026-10-07T09:30:00+05:30"));
    });

    it("finishing a unit that was never started is allowed and records the start too", async () => {
      const { kitchen, units, orderId } = await confirmed();
      clock.set("2026-10-07T09:45:00+05:30");
      await kitchen.post(`/kitchen/units/${units[0]}/done`).expect(201);
      const u = await unit(units[0]);
      expect(u.status).toBe("DONE");
      expect(u.startedAt).toEqual(new Date("2026-10-07T09:45:00+05:30"));
      expect(u.doneAt).toEqual(new Date("2026-10-07T09:45:00+05:30"));
      expect((await order(orderId)).kitchenStartedAt).toEqual(new Date("2026-10-07T09:45:00+05:30"));
    });

    it("a unit cannot be finished twice", async () => {
      const { kitchen, units } = await confirmed();
      await kitchen.post(`/kitchen/units/${units[0]}/done`).expect(201);
      const again = await kitchen.post(`/kitchen/units/${units[0]}/done`);
      expect(again.status).toBe(409);
      expect(again.body.code).toBe("UNIT_ALREADY_DONE");
    });

    it("a finished unit cannot be started again", async () => {
      const { kitchen, units } = await confirmed();
      await kitchen.post(`/kitchen/units/${units[0]}/done`);
      expect((await kitchen.post(`/kitchen/units/${units[0]}/start`)).status).toBe(409);
    });

    it("RF4: two people finishing the same unit at the same moment: exactly one wins", async () => {
      const { kitchen, units } = await confirmed();
      const other = await loginAs(app, "admin@test.com");
      await kitchen.post(`/kitchen/units/${units[0]}/start`);
      const hold = holdUntilBothArrive();
      const results = await Promise.all([kitchen.post(`/kitchen/units/${units[0]}/done`), other.post(`/kitchen/units/${units[0]}/done`)]);
      hold.mockRestore();
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect((await unit(units[0])).version).toBe(2); // start + one finish
    });

    it("RF4: two people finishing never-started unit at the same moment: exactly one wins", async () => {
      const { kitchen, units } = await confirmed();
      const other = await loginAs(app, "admin@test.com");
      const results = await Promise.all([kitchen.post(`/kitchen/units/${units[0]}/done`), other.post(`/kitchen/units/${units[0]}/done`)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect((await unit(units[0])).version).toBe(1);
    });
  });

  describe("the order becomes kitchen-ready only when every unit is done", () => {
    it("after the last unit, not before", async () => {
      const { kitchen, units, orderId } = await confirmed();
      clock.set("2026-10-07T10:00:00+05:30");
      await kitchen.post(`/kitchen/units/${units[0]}/done`);
      expect((await order(orderId)).kitchenReadyAt).toBeNull();
      clock.set("2026-10-07T10:20:00+05:30");
      await kitchen.post(`/kitchen/units/${units[1]}/done`);
      expect((await order(orderId)).kitchenReadyAt).toEqual(new Date("2026-10-07T10:20:00+05:30"));
      expect(await prisma.orderEvent.count({ where: { orderId, type: "KITCHEN_READY" } })).toBe(1);
    });

    it("RF4: the last two units finished at the same moment still make the order ready exactly once", async () => {
      const { kitchen, units, orderId } = await confirmed();
      const other = await loginAs(app, "admin@test.com");
      // Both are already started, so finishing them touches nothing on the order except the
      // "is everything done?" check: the case where a missed lock would lose the ready signal.
      await kitchen.post(`/kitchen/units/${units[0]}/start`);
      await kitchen.post(`/kitchen/units/${units[1]}/start`);
      const hold = holdUntilBothArrive();
      const results = await Promise.all([kitchen.post(`/kitchen/units/${units[0]}/done`), other.post(`/kitchen/units/${units[1]}/done`)]);
      hold.mockRestore();
      expect(results.map((r) => r.status)).toEqual([201, 201]);
      expect((await order(orderId)).kitchenReadyAt).not.toBeNull();
      expect(await prisma.orderEvent.count({ where: { orderId, type: "KITCHEN_READY" } })).toBe(1);
    });
  });

  describe("orders that are not confirmed", () => {
    it("a cancelled order's units cannot be started or finished", async () => {
      const { admin, kitchen, units, orderId } = await confirmed();
      await admin.post(`/orders/${orderId}/cancel`).send({}).expect(201);
      for (const action of ["start", "done"]) {
        const res = await kitchen.post(`/kitchen/units/${units[0]}/${action}`);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("ORDER_NOT_CONFIRMED");
      }
      expect((await unit(units[0])).status).toBe("PENDING");
    });

    it("an unknown unit is 404", async () => {
      const { kitchen } = await confirmed();
      expect((await kitchen.post("/kitchen/units/99999/start")).status).toBe(404);
    });
  });

  describe("admin force-complete", () => {
    it("finishes every unit of an order, records starts, and makes it kitchen-ready", async () => {
      const { admin, kitchen, units, orderId } = await confirmed();
      clock.set("2026-10-07T09:00:00+05:30");
      await kitchen.post(`/kitchen/units/${units[0]}/start`);
      clock.set("2026-10-07T10:00:00+05:30");
      const res = await admin.post(`/orders/${orderId}/force-complete`);
      expect(res.status).toBe(201);
      expect(res.body.unitsCompleted).toBe(2);
      const all = await Promise.all(units.map(unit));
      expect(all.every((u) => u.status === "DONE" && u.startedAt && u.doneAt)).toBe(true);
      expect(all[0].startedAt).toEqual(new Date("2026-10-07T09:00:00+05:30")); // an existing start is kept
      expect(all[1].startedAt).toEqual(new Date("2026-10-07T10:00:00+05:30"));
      const o = await order(orderId);
      expect(o.kitchenReadyAt).toEqual(new Date("2026-10-07T10:00:00+05:30"));
      expect(o.kitchenStartedAt).toEqual(new Date("2026-10-07T09:00:00+05:30"));
      expect(await prisma.orderEvent.count({ where: { orderId, type: "FORCE_COMPLETED" } })).toBe(1);
    });

    it("needs a confirmed order and override rights, and a second call changes nothing", async () => {
      const { admin, kitchen, units, orderId } = await confirmed();
      expect((await kitchen.post(`/orders/${orderId}/force-complete`)).status).toBe(403);
      await admin.post(`/orders/${orderId}/force-complete`).expect(201);
      const again = await admin.post(`/orders/${orderId}/force-complete`);
      expect(again.status).toBe(201);
      expect(again.body.unitsCompleted).toBe(0);
      expect((await unit(units[0])).version).toBe(1);

      expect((await admin.post("/orders/99999/force-complete")).status).toBe(404);
    });
  });

  describe("who may do what", () => {
    it("kitchen and admin use the board; dispatch and driver cannot", async () => {
      const { units } = await confirmed();
      expect((await (await loginAs(app, "admin@test.com")).get(`/kitchen/board?date=${DELIVERY_DATE}`)).status).toBe(200);
      for (const who of ["dispatch@test.com", "driver@test.com"]) {
        const agent = await loginAs(app, who);
        expect((await agent.get(`/kitchen/board?date=${DELIVERY_DATE}`)).status).toBe(403);
        expect((await agent.post(`/kitchen/units/${units[0]}/start`)).status).toBe(403);
        expect((await agent.post(`/kitchen/units/${units[0]}/done`)).status).toBe(403);
      }
    });

    it("kitchen cannot place or change orders, only work on them", async () => {
      const { kitchen, w, orderId } = await confirmed();
      expect((await kitchen.post("/orders").send(tenBowls(w))).status).toBe(403);
      expect((await kitchen.post(`/orders/${orderId}/cancel`).send({})).status).toBe(403);
      expect((await kitchen.patch(`/orders/${orderId}/override`).send({ deliveryTime: "14:00" })).status).toBe(403);
    });
  });
});
