import { INestApplication } from "@nestjs/common";
import { DispatchService } from "../src/dispatch/dispatch.service";
import { CutoffProcessor } from "../src/orders/cutoff-processor.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp, FakeClock, loginAs, resetAndSeedAuth } from "./helpers/app";
import { AFTER_CUTOFF, BEFORE_CUTOFF, DELIVERY_DATE, orderWorld, tenBowls } from "./helpers/order-world";

// Delivery is Wed 7 Oct 2026 at 13:00 IST. "noon" is before it, "afterwards" is after.
const NOON = "2026-10-07T12:00:00+05:30";

describe("dispatch board, drops and the driver view (e2e)", () => {
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

  // Confirmed orders (one per time given), each in a drop. Optionally made kitchen-ready.
  async function setup(opts: { times?: string[]; kitchenReady?: boolean; driver?: boolean } = {}) {
    const times = opts.times ?? ["13:00"];
    const w = await orderWorld(prisma, { canChangeTime: true });
    const staff = (email: string) => prisma.staff.findUniqueOrThrow({ where: { email } });
    const driverStaff = await staff("driver@test.com");
    if (opts.driver) await prisma.company.update({ where: { id: w.company.id }, data: { defaultDriverId: driverStaff.id } });

    const admin = await loginAs(app, "admin@test.com");
    const orderIds: number[] = [];
    for (const deliveryTime of times) {
      const res = await admin.post("/orders").send(tenBowls(w, { deliveryTime }));
      if (res.status !== 201) throw new Error(JSON.stringify(res.body));
      orderIds.push(res.body.id);
    }
    clock.set(AFTER_CUTOFF);
    await processor.processDate(DELIVERY_DATE);
    if (opts.kitchenReady) for (const id of orderIds) await admin.post(`/orders/${id}/force-complete`).expect(201);
    const dispatch = await loginAs(app, "dispatch@test.com");
    const driver = await loginAs(app, "driver@test.com");
    const dropIds = await Promise.all(orderIds.map(async (id) => (await prisma.order.findUniqueOrThrow({ where: { id } })).dropId!));
    return { w, admin, dispatch, driver, orderIds, dropIds, driverStaff };
  }
  const drop = (id: number) => prisma.drop.findUniqueOrThrow({ where: { id } });
  const order = (id: number) => prisma.order.findUniqueOrThrow({ where: { id } });

  describe("the board", () => {
    it("lists the day's drops in time order, grouping orders for the same company, address and time", async () => {
      const { dispatch, orderIds, dropIds } = await setup({ times: ["15:00", "13:00", "13:00"] });
      const res = await dispatch.get(`/dispatch/board?date=${DELIVERY_DATE}`);
      expect(res.status).toBe(200);
      expect(res.body.drops.map((d: { deliveryTime: string }) => d.deliveryTime)).toEqual(["13:00", "15:00"]);
      const [one, two] = res.body.drops;
      expect(one.orders.map((o: { id: number }) => o.id).sort()).toEqual([orderIds[1], orderIds[2]].sort());
      expect(one).toMatchObject({ id: dropIds[1], status: "OPEN", company: { name: "Acme" }, address: { label: "HQ" }, driver: null });
      expect(two.orders).toHaveLength(1);
      expect(one.orders[0]).toMatchObject({ employeeName: "Employee", itemCount: 10, stage: "COOKING" });
    });

    it("says what blocks the next step: cooking, then ready to dispatch", async () => {
      const { dispatch, admin, orderIds } = await setup();
      let [d] = (await dispatch.get(`/dispatch/board?date=${DELIVERY_DATE}`)).body.drops;
      expect(d.nextAction).toBeNull();
      expect(d.blocker).toMatch(/cooking/i);
      await admin.post(`/orders/${orderIds[0]}/force-complete`);
      [d] = (await dispatch.get(`/dispatch/board?date=${DELIVERY_DATE}`)).body.drops;
      expect(d.nextAction).toBe("dispatch-ready");
      expect(d.blocker).toBeNull();
    });

    it("totals: drops by status, unassigned, and late", async () => {
      const { dispatch } = await setup({ times: ["13:00", "15:00"], kitchenReady: true });
      clock.set("2026-10-07T13:30:00+05:30"); // the 13:00 drop is now late, the 15:00 one is not
      const res = await dispatch.get(`/dispatch/board?date=${DELIVERY_DATE}`);
      expect(res.body.totals).toMatchObject({ open: 2, dispatchReady: 0, outForDelivery: 0, delivered: 0, unassigned: 2, late: 1 });
      expect(res.body.drops[0].late).toBe(true);
      expect(res.body.drops[1].late).toBe(false);
    });

    it("defaults to today in the kitchen zone and processes due cut-offs on load", async () => {
      const w = await orderWorld(prisma);
      const admin = await loginAs(app, "admin@test.com");
      await admin.post("/orders").send(tenBowls(w)).expect(201);
      clock.set("2026-10-06T22:00:00Z"); // 03:30 IST on the 7th, cut-off long gone, nobody ran it
      const res = await (await loginAs(app, "dispatch@test.com")).get("/dispatch/board");
      expect(res.body.date).toBe(DELIVERY_DATE);
      expect(res.body.drops).toHaveLength(1);
    });

    it("ignores cancelled orders and shows no drop that has none left", async () => {
      const { dispatch, admin, orderIds } = await setup({ times: ["13:00", "13:00"] });
      await admin.post(`/orders/${orderIds[0]}/cancel`).send({}).expect(201);
      let res = await dispatch.get(`/dispatch/board?date=${DELIVERY_DATE}`);
      expect(res.body.drops[0].orders.map((o: { id: number }) => o.id)).toEqual([orderIds[1]]);
      await admin.post(`/orders/${orderIds[1]}/cancel`).send({}).expect(201);
      res = await dispatch.get(`/dispatch/board?date=${DELIVERY_DATE}`);
      expect(res.body.drops).toEqual([]);
    });
  });

  describe("drivers", () => {
    it("a drop starts with the company's default driver", async () => {
      const { dispatch, driverStaff } = await setup({ driver: true });
      const [d] = (await dispatch.get(`/dispatch/board?date=${DELIVERY_DATE}`)).body.drops;
      expect(d.driver).toMatchObject({ id: driverStaff.id, name: "Dinesh Driver" });
    });

    it("dispatch assigns and unassigns a driver", async () => {
      const { dispatch, dropIds, driverStaff } = await setup();
      const assigned = await dispatch.patch(`/drops/${dropIds[0]}/driver`).send({ driverId: driverStaff.id });
      expect(assigned.status).toBe(200);
      expect((await drop(dropIds[0])).driverId).toBe(driverStaff.id);
      await dispatch.patch(`/drops/${dropIds[0]}/driver`).send({ driverId: null }).expect(200);
      expect((await drop(dropIds[0])).driverId).toBeNull();
    });

    it("only someone with driver access can be assigned", async () => {
      const { dispatch, dropIds } = await setup();
      const kitchen = await prisma.staff.findUniqueOrThrow({ where: { email: "kitchen@test.com" } });
      const res = await dispatch.patch(`/drops/${dropIds[0]}/driver`).send({ driverId: kitchen.id });
      expect(res.status).toBe(400);
      expect(res.body.fields.driverId).toBeDefined();
      expect((await dispatch.patch(`/drops/${dropIds[0]}/driver`).send({ driverId: 99999 })).status).toBe(400);
      expect((await dispatch.patch("/drops/99999/driver").send({ driverId: null })).status).toBe(404);
    });
  });

  describe("moving a drop through its stages", () => {
    it("dispatch-ready -> out for delivery -> delivered, with the order timestamps, events and statuses", async () => {
      const { dispatch, orderIds, dropIds } = await setup({ kitchenReady: true, driver: true });
      clock.set("2026-10-07T12:10:00+05:30");
      await dispatch.post(`/drops/${dropIds[0]}/dispatch-ready`).expect(201);
      expect((await drop(dropIds[0])).status).toBe("DISPATCH_READY");
      expect((await order(orderIds[0])).dispatchReadyAt).toEqual(new Date("2026-10-07T12:10:00+05:30"));

      clock.set("2026-10-07T12:20:00+05:30");
      await dispatch.post(`/drops/${dropIds[0]}/out-for-delivery`).expect(201);
      expect((await order(orderIds[0])).outForDeliveryAt).toEqual(new Date("2026-10-07T12:20:00+05:30"));

      clock.set("2026-10-07T12:50:00+05:30");
      const res = await dispatch.post(`/drops/${dropIds[0]}/delivered`).send({ note: "Left with reception", photoUrl: "https://example.com/p.jpg" });
      expect(res.status).toBe(201);
      const d = await drop(dropIds[0]);
      expect(d).toMatchObject({ status: "DELIVERED", note: "Left with reception", photoUrl: "https://example.com/p.jpg" });
      expect(d.deliveredAt).toEqual(new Date("2026-10-07T12:50:00+05:30"));
      const o = await order(orderIds[0]);
      expect(o).toMatchObject({ status: "DELIVERED", onTime: true });
      expect(o.deliveredAt).toEqual(new Date("2026-10-07T12:50:00+05:30"));

      const types = (await prisma.orderEvent.findMany({ where: { orderId: orderIds[0] }, orderBy: { id: "asc" } })).map((e) => e.type);
      expect(types).toEqual(["CREATED", "PLACED", "CONFIRMED", "FORCE_COMPLETED", "DISPATCH_READY", "OUT_FOR_DELIVERY", "DELIVERED"]);
    });

    it("every order of the drop moves together", async () => {
      const { dispatch, orderIds, dropIds } = await setup({ times: ["13:00", "13:00"], kitchenReady: true, driver: true });
      expect(dropIds[0]).toBe(dropIds[1]);
      await dispatch.post(`/drops/${dropIds[0]}/dispatch-ready`).expect(201);
      await dispatch.post(`/drops/${dropIds[0]}/out-for-delivery`).expect(201);
      await dispatch.post(`/drops/${dropIds[0]}/delivered`).send({}).expect(201);
      for (const id of orderIds) expect((await order(id)).status).toBe("DELIVERED");
    });

    it("out for delivery needs an assigned driver", async () => {
      const { dispatch, dropIds } = await setup({ kitchenReady: true });
      await dispatch.post(`/drops/${dropIds[0]}/dispatch-ready`).expect(201);
      const res = await dispatch.post(`/drops/${dropIds[0]}/out-for-delivery`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("DRIVER_REQUIRED");
      expect((await drop(dropIds[0])).status).toBe("DISPATCH_READY");
    });

    it("dispatch-ready is refused while any order of the drop is still cooking, and changes nothing", async () => {
      const { dispatch, admin, orderIds, dropIds } = await setup({ times: ["13:00", "13:00"] });
      await admin.post(`/orders/${orderIds[0]}/force-complete`).expect(201); // only one of the two is ready
      const res = await dispatch.post(`/drops/${dropIds[0]}/dispatch-ready`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("ORDERS_NOT_READY");
      expect((await order(orderIds[0])).dispatchReadyAt).toBeNull();
      expect((await drop(dropIds[0])).status).toBe("OPEN");
    });

    it("cannot skip a step, repeat a step or go back", async () => {
      const { dispatch, dropIds } = await setup({ kitchenReady: true, driver: true });
      const d = dropIds[0];
      expect((await dispatch.post(`/drops/${d}/out-for-delivery`)).body.code).toBe("INVALID_TRANSITION"); // skip
      expect((await dispatch.post(`/drops/${d}/delivered`).send({})).body.code).toBe("INVALID_TRANSITION"); // skip
      await dispatch.post(`/drops/${d}/dispatch-ready`).expect(201);
      expect((await dispatch.post(`/drops/${d}/dispatch-ready`)).body.code).toBe("INVALID_TRANSITION"); // repeat
      await dispatch.post(`/drops/${d}/out-for-delivery`).expect(201);
      expect((await dispatch.post(`/drops/${d}/out-for-delivery`)).body.code).toBe("INVALID_TRANSITION"); // repeat
      await dispatch.post(`/drops/${d}/delivered`).send({}).expect(201);
      for (const step of ["dispatch-ready", "out-for-delivery"]) {
        expect((await dispatch.post(`/drops/${d}/${step}`)).status).toBe(409); // nothing after delivered
      }
      expect((await dispatch.post(`/drops/${d}/delivered`).send({})).status).toBe(409);
    });

    it("a cancelled order inside a drop is left out and does not block it", async () => {
      const { dispatch, admin, orderIds, dropIds } = await setup({ times: ["13:00", "13:00"], driver: true });
      await admin.post(`/orders/${orderIds[1]}/cancel`).send({}).expect(201); // never became ready
      await admin.post(`/orders/${orderIds[0]}/force-complete`).expect(201);
      await dispatch.post(`/drops/${dropIds[0]}/dispatch-ready`).expect(201);
      expect((await order(orderIds[1])).dispatchReadyAt).toBeNull();
      expect((await order(orderIds[1])).status).toBe("CANCELLED");
    });

    it("unknown drops are 404", async () => {
      const { dispatch } = await setup();
      for (const step of ["dispatch-ready", "out-for-delivery"]) expect((await dispatch.post(`/drops/99999/${step}`)).status).toBe(404);
      expect((await dispatch.post("/drops/99999/delivered").send({})).status).toBe(404);
    });

    it("RF4: two simultaneous dispatch-ready requests: one wins, one is refused", async () => {
      const { dispatch, admin, orderIds, dropIds } = await setup({ kitchenReady: true });
      const other = await loginAs(app, "dispatch@test.com");
      const service = app.get(DispatchService) as unknown as { dropOrThrow: (id: number) => Promise<unknown> };
      const real = service.dropOrThrow.bind(service);
      let arrived = 0;
      let open!: () => void;
      const gate = new Promise<void>((resolve) => (open = resolve));
      const spy = jest.spyOn(service, "dropOrThrow").mockImplementation(async (id: number) => {
        if (++arrived >= 2) open();
        await gate;
        return real(id);
      });
      const results = await Promise.all([dispatch.post(`/drops/${dropIds[0]}/dispatch-ready`), other.post(`/drops/${dropIds[0]}/dispatch-ready`)]);
      spy.mockRestore();
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await prisma.orderEvent.count({ where: { orderId: orderIds[0], type: "DISPATCH_READY" } })).toBe(1);
      void admin;
    });
  });

  describe("on time or late", () => {
    async function deliverAt(time: string, grace?: number) {
      const s = await setup({ kitchenReady: true, driver: true });
      if (grace !== undefined) await s.admin.put("/settings").send({ onTimeGraceMinutes: grace }).expect(200);
      clock.set("2026-10-07T12:00:00+05:30");
      await s.dispatch.post(`/drops/${s.dropIds[0]}/dispatch-ready`).expect(201);
      await s.dispatch.post(`/drops/${s.dropIds[0]}/out-for-delivery`).expect(201);
      clock.set(time);
      await s.dispatch.post(`/drops/${s.dropIds[0]}/delivered`).send({}).expect(201);
      return order(s.orderIds[0]);
    }

    it("delivered by the delivery time is on time; one minute after is late", async () => {
      expect((await deliverAt("2026-10-07T13:00:00+05:30")).onTime).toBe(true);
    });
    it("late when after the delivery time", async () => {
      expect((await deliverAt("2026-10-07T13:01:00+05:30")).onTime).toBe(false);
    });
    it("the grace setting widens the on-time window", async () => {
      expect((await deliverAt("2026-10-07T13:10:00+05:30", 15)).onTime).toBe(true);
    });
    it("beyond the grace it is still late", async () => {
      expect((await deliverAt("2026-10-07T13:16:00+05:30", 15)).onTime).toBe(false);
    });
  });

  describe("the driver view", () => {
    it("a driver sees only their own drops for today, in time order", async () => {
      const { w, admin, driver, dispatch, dropIds, driverStaff } = await setup({ times: ["15:00", "13:00", "14:00"], kitchenReady: true });
      const adminStaff = await prisma.staff.findUniqueOrThrow({ where: { email: "admin@test.com" } });
      // the 15:00 and 13:00 drops are the driver's; the 14:00 one belongs to somebody else
      await dispatch.patch(`/drops/${dropIds[0]}/driver`).send({ driverId: driverStaff.id });
      await dispatch.patch(`/drops/${dropIds[1]}/driver`).send({ driverId: driverStaff.id });
      await admin.patch(`/drops/${dropIds[2]}/driver`).send({ driverId: adminStaff.id });
      // a drop on another day is not shown either
      const tomorrow = await prisma.drop.create({ data: { companyId: w.company.id, addressId: w.hq.id, deliveryDate: new Date("2026-10-08T00:00:00Z"), deliveryTime: "13:00", driverId: driverStaff.id } });
      void tomorrow;

      clock.set(NOON);
      const res = await driver.get("/driver/drops");
      expect(res.status).toBe(200);
      expect(res.body.date).toBe(DELIVERY_DATE);
      expect(res.body.drops.map((d: { id: number }) => d.id)).toEqual([dropIds[1], dropIds[0]]); // 13:00 then 15:00
      expect(res.body.drops[0]).toMatchObject({ deliveryTime: "13:00", status: "OPEN", company: { name: "Acme" }, instructions: "" });
      expect(res.body.drops[0].address).toMatchObject({ label: "HQ", line1: "HQ Street 1" });
      expect(res.body.drops[0].orders[0]).toMatchObject({ employeeName: "Employee", itemCount: 10 });
    });

    it("RF1: 'today' follows the kitchen zone, not the server's", async () => {
      const { dispatch, driver, dropIds, driverStaff } = await setup({ kitchenReady: true });
      await dispatch.patch(`/drops/${dropIds[0]}/driver`).send({ driverId: driverStaff.id });
      clock.set("2026-10-06T22:00:00Z"); // 03:30 IST on the 7th
      expect((await driver.get("/driver/drops")).body.drops).toHaveLength(1);
      clock.set("2026-10-06T17:00:00Z"); // 22:30 IST on the 6th
      expect((await driver.get("/driver/drops")).body.drops).toHaveLength(0);
    });

    it("a driver marks their own out-for-delivery drop delivered, with a note and photo", async () => {
      const { dispatch, driver, orderIds, dropIds } = await setup({ kitchenReady: true, driver: true });
      clock.set(NOON);
      await dispatch.post(`/drops/${dropIds[0]}/dispatch-ready`);
      await dispatch.post(`/drops/${dropIds[0]}/out-for-delivery`);
      const res = await driver.post(`/driver/drops/${dropIds[0]}/delivered`).send({ note: "Gate 2", photoUrl: "http://example.com/x.png" });
      expect(res.status).toBe(201);
      expect(await drop(dropIds[0])).toMatchObject({ status: "DELIVERED", note: "Gate 2", photoUrl: "http://example.com/x.png" });
      expect((await order(orderIds[0])).status).toBe("DELIVERED");
      const event = await prisma.orderEvent.findFirstOrThrow({ where: { orderId: orderIds[0], type: "DELIVERED" } });
      expect(event.actor).toBe("Dinesh Driver");
    });

    it("a driver cannot touch another driver's drop (it looks like it does not exist)", async () => {
      const { dispatch, admin, driver, dropIds } = await setup({ kitchenReady: true });
      const adminStaff = await prisma.staff.findUniqueOrThrow({ where: { email: "admin@test.com" } });
      await admin.patch(`/drops/${dropIds[0]}/driver`).send({ driverId: adminStaff.id });
      clock.set(NOON);
      await dispatch.post(`/drops/${dropIds[0]}/dispatch-ready`);
      await dispatch.post(`/drops/${dropIds[0]}/out-for-delivery`);
      expect((await driver.post(`/driver/drops/${dropIds[0]}/delivered`).send({})).status).toBe(404);
      expect((await drop(dropIds[0])).status).toBe("OUT_FOR_DELIVERY");
    });

    it("cannot deliver a drop that is not out for delivery, or one that is not today's", async () => {
      const { dispatch, driver, dropIds } = await setup({ kitchenReady: true, driver: true });
      clock.set(NOON);
      expect((await driver.post(`/driver/drops/${dropIds[0]}/delivered`).send({})).status).toBe(409);
      await dispatch.post(`/drops/${dropIds[0]}/dispatch-ready`);
      await dispatch.post(`/drops/${dropIds[0]}/out-for-delivery`);
      clock.set("2026-10-08T12:00:00+05:30"); // the next day
      expect((await driver.post(`/driver/drops/${dropIds[0]}/delivered`).send({})).status).toBe(404);
    });

    it("rejects an unsafe photo link and an over-long note", async () => {
      const { dispatch, driver, dropIds } = await setup({ kitchenReady: true, driver: true });
      clock.set(NOON);
      await dispatch.post(`/drops/${dropIds[0]}/dispatch-ready`);
      await dispatch.post(`/drops/${dropIds[0]}/out-for-delivery`);
      const bad = await driver.post(`/driver/drops/${dropIds[0]}/delivered`).send({ photoUrl: "javascript:alert(1)" });
      expect(bad.status).toBe(400);
      expect(bad.body.fields.photoUrl).toBeDefined();
      expect((await driver.post(`/driver/drops/${dropIds[0]}/delivered`).send({ note: "x".repeat(501) })).status).toBe(400);
      expect((await drop(dropIds[0])).status).toBe("OUT_FOR_DELIVERY");
    });
  });

  describe("who may do what", () => {
    it("dispatch and admin use the board; kitchen and driver cannot", async () => {
      const { dropIds } = await setup({ kitchenReady: true, driver: true });
      expect((await (await loginAs(app, "admin@test.com")).get(`/dispatch/board?date=${DELIVERY_DATE}`)).status).toBe(200);
      for (const who of ["kitchen@test.com", "driver@test.com"]) {
        const agent = await loginAs(app, who);
        expect((await agent.get(`/dispatch/board?date=${DELIVERY_DATE}`)).status).toBe(403);
        expect((await agent.post(`/drops/${dropIds[0]}/dispatch-ready`)).status).toBe(403);
        expect((await agent.patch(`/drops/${dropIds[0]}/driver`).send({ driverId: null })).status).toBe(403);
        expect((await agent.post(`/drops/${dropIds[0]}/delivered`).send({})).status).toBe(403);
      }
    });

    it("only drivers use /driver/drops", async () => {
      await setup();
      for (const who of ["kitchen@test.com", "dispatch@test.com"]) {
        expect((await (await loginAs(app, who)).get("/driver/drops")).status).toBe(403);
      }
    });
  });
});
