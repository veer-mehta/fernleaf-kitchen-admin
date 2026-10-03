import { INestApplication } from "@nestjs/common";
import { CutoffProcessor } from "../src/orders/cutoff-processor.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { SettingsService } from "../src/settings/settings.service";
import { createTestApp, FakeClock, loginAs, resetAndSeedAuth } from "./helpers/app";
import { AFTER_CUTOFF, BEFORE_CUTOFF, DELIVERY_DATE, orderWorld, tenBowls, type OrderWorld } from "./helpers/order-world";

describe("cut-off processing (e2e)", () => {
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
    return res.body;
  };

  // A draft and three placed orders for the same date: two share company/address/time, one is at another time.
  async function busyDay() {
    const w = await orderWorld(prisma, { canChangeTime: true });
    const colleague = await w.f.employee(w.company.id, "ben@acme.com", { canChangeTime: true });
    const admin = await loginAs(app, "admin@test.com");
    const draft = await place(admin, w, { status: "DRAFT" });
    const a = await place(admin, w);
    const b = await place(admin, w, { employeeId: colleague.id });
    const late = await place(admin, w, { deliveryTime: "15:00" });
    return { w, admin, draft, a, b, late };
  }
  const statusOf = async (id: number) => (await prisma.order.findUniqueOrThrow({ where: { id } })).status;

  it("cancels drafts and confirms placed orders for the date", async () => {
    const { draft, a, b, late } = await busyDay();
    clock.set(AFTER_CUTOFF);
    const result = await processor.processDate(DELIVERY_DATE);
    expect(result).toEqual({ date: DELIVERY_DATE, cancelled: 1, confirmed: 3 });
    expect(await statusOf(draft.id)).toBe("CANCELLED");
    for (const o of [a, b, late]) expect(await statusOf(o.id)).toBe("CONFIRMED");
  });

  it("creates one prep unit per distinct combination, routed to the dish's station", async () => {
    const w = await orderWorld(prisma);
    const station = await prisma.kitchenStation.create({ data: { name: "Hot line" } });
    await prisma.dish.update({ where: { id: w.dish.id }, data: { stationId: station.id } });
    const admin = await loginAs(app, "admin@test.com");
    await place(admin, w); // 2 combinations
    await place(admin, w); // 2 more
    clock.set(AFTER_CUTOFF);
    await processor.processDate(DELIVERY_DATE);

    const units = await prisma.prepUnit.findMany();
    expect(units).toHaveLength(4);
    expect(units.every((u) => u.stationId === station.id && u.status === "PENDING" && u.version === 0)).toBe(true);
    // units correspond one-to-one with combinations
    expect(await prisma.orderLineCombination.count()).toBe(4);
  });

  it("a dish with no station gives units with no station (Unassigned)", async () => {
    const w = await orderWorld(prisma);
    const admin = await loginAs(app, "admin@test.com");
    await place(admin, w);
    clock.set(AFTER_CUTOFF);
    await processor.processDate(DELIVERY_DATE);
    expect((await prisma.prepUnit.findMany()).every((u) => u.stationId === null)).toBe(true);
  });

  it("groups orders into drops by company + address + exact delivery time", async () => {
    const { a, b, late } = await busyDay();
    clock.set(AFTER_CUTOFF);
    await processor.processDate(DELIVERY_DATE);

    const [oa, ob, ol] = await Promise.all([a, b, late].map((o) => prisma.order.findUniqueOrThrow({ where: { id: o.id } })));
    expect(oa.dropId).not.toBeNull();
    expect(oa.dropId).toBe(ob.dropId); // same company, address and time
    expect(ol.dropId).not.toBe(oa.dropId); // 15:00 is a different drop
    expect(await prisma.drop.count()).toBe(2);
    const drop = await prisma.drop.findUniqueOrThrow({ where: { id: oa.dropId! } });
    expect(drop.deliveryTime).toBe("13:00");
    expect(drop.status).toBe("OPEN");
  });

  it("a different address is a different drop", async () => {
    const w = await orderWorld(prisma, { canChooseAddress: true });
    const admin = await loginAs(app, "admin@test.com");
    const hq = await place(admin, w);
    const plant = await place(admin, w, { addressId: w.plant.id });
    clock.set(AFTER_CUTOFF);
    await processor.processDate(DELIVERY_DATE);
    const dropIds = await Promise.all([hq, plant].map(async (o) => (await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).dropId));
    expect(new Set(dropIds).size).toBe(2);
  });

  it("new drops start with the company's default driver", async () => {
    const w = await orderWorld(prisma);
    const driver = await prisma.staff.findUniqueOrThrow({ where: { email: "driver@test.com" } });
    await prisma.company.update({ where: { id: w.company.id }, data: { defaultDriverId: driver.id } });
    const admin = await loginAs(app, "admin@test.com");
    await place(admin, w);
    clock.set(AFTER_CUTOFF);
    await processor.processDate(DELIVERY_DATE);
    expect((await prisma.drop.findFirstOrThrow()).driverId).toBe(driver.id);
  });

  it("records CANCELLED and CONFIRMED on the timeline, done by the System", async () => {
    const { draft, a } = await busyDay();
    clock.set(AFTER_CUTOFF);
    await processor.processDate(DELIVERY_DATE);
    const detail = (await (await loginAs(app, "admin@test.com")).get(`/orders/${a.id}`)).body;
    expect(detail.timeline.at(-1)).toMatchObject({ type: "CONFIRMED", actor: "System" });
    const draftDetail = (await (await loginAs(app, "admin@test.com")).get(`/orders/${draft.id}`)).body;
    expect(draftDetail.timeline.at(-1)).toMatchObject({ type: "CANCELLED", actor: "System" });
  });

  it("RF4: running it twice for the same date changes nothing the second time", async () => {
    await busyDay();
    clock.set(AFTER_CUTOFF);
    await processor.processDate(DELIVERY_DATE);
    const snapshot = async () => ({
      units: await prisma.prepUnit.count(),
      drops: await prisma.drop.count(),
      events: await prisma.orderEvent.count(),
      confirmed: await prisma.order.count({ where: { status: "CONFIRMED" } }),
    });
    const first = await snapshot();
    const again = await processor.processDate(DELIVERY_DATE);
    expect(again).toEqual({ date: DELIVERY_DATE, cancelled: 0, confirmed: 0 });
    expect(await snapshot()).toEqual(first);
  });

  it("RF4: two runs at the same moment confirm each order exactly once (no duplicate units)", async () => {
    // Only placed orders, no drafts: a draft's row lock would make the second run wait for the
    // first to finish, hiding the very race this test is about.
    const w = await orderWorld(prisma, { canChangeTime: true });
    const admin = await loginAs(app, "admin@test.com");
    for (let i = 0; i < 10; i++) await place(admin, w);
    await place(admin, w, { deliveryTime: "15:00" });
    clock.set(AFTER_CUTOFF);

    // Hold both runs at a barrier until BOTH have started, so they really do overlap in time.
    // (Without this the first run often finishes before the second begins and nothing is tested.)
    const settings = app.get(SettingsService);
    const realGet = settings.getKitchenSettings.bind(settings);
    let arrived = 0;
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const spy = jest.spyOn(settings, "getKitchenSettings").mockImplementation(async () => {
      const value = await realGet();
      if (++arrived >= 2) open();
      await gate;
      return value;
    });
    try {
      const [r1, r2] = await Promise.all([processor.processDate(DELIVERY_DATE), processor.processDate(DELIVERY_DATE)]);
      expect(r1.confirmed + r2.confirmed).toBe(11); // each order is confirmed by exactly one run
      expect(r1.cancelled + r2.cancelled).toBe(0);
    } finally {
      spy.mockRestore();
    }
    expect(await prisma.prepUnit.count()).toBe(22); // 11 orders x 2 combinations, no duplicates
    expect(await prisma.orderEvent.count({ where: { type: "CONFIRMED" } })).toBe(11);
    expect(await prisma.drop.count()).toBe(2); // 13:00 and 15:00, not duplicated
  });

  it("is refused before the cut-off (CUTOFF_NOT_REACHED) and changes nothing", async () => {
    const { a } = await busyDay();
    await expect(processor.processDate(DELIVERY_DATE)).rejects.toMatchObject({ code: "CUTOFF_NOT_REACHED" });
    expect(await statusOf(a.id)).toBe("PLACED");
    expect(await prisma.prepUnit.count()).toBe(0);
  });

  it("leaves other dates and finished orders alone", async () => {
    const w = await orderWorld(prisma);
    const admin = await loginAs(app, "admin@test.com");
    const cancelled = await place(admin, w);
    await admin.post(`/orders/${cancelled.id}/cancel`).send({});
    const rejected = await place(admin, w);
    await admin.post(`/orders/${rejected.id}/reject`).send({ reason: "no" });
    const nextWeek = await place(admin, w, { deliveryDate: "2026-10-14" });
    clock.set(AFTER_CUTOFF);
    expect(await processor.processDate(DELIVERY_DATE)).toEqual({ date: DELIVERY_DATE, cancelled: 0, confirmed: 0 });
    expect(await statusOf(cancelled.id)).toBe("CANCELLED");
    expect(await statusOf(rejected.id)).toBe("REJECTED");
    expect(await statusOf(nextWeek.id)).toBe("PLACED");
  });

  it("a date with no orders is simply zero", async () => {
    clock.set(AFTER_CUTOFF);
    expect(await processor.processDate(DELIVERY_DATE)).toEqual({ date: DELIVERY_DATE, cancelled: 0, confirmed: 0 });
  });

  it("does not touch the planned times or start the kitchen", async () => {
    const { a } = await busyDay();
    const before = await prisma.order.findUniqueOrThrow({ where: { id: a.id } });
    clock.set(AFTER_CUTOFF);
    await processor.processDate(DELIVERY_DATE);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: a.id } });
    expect(after.plannedKitchenReadyAt).toEqual(before.plannedKitchenReadyAt);
    expect(after.kitchenStartedAt).toBeNull();
    expect(after.kitchenReadyAt).toBeNull();
  });

  describe("processDueDates (the background job and the lazy check)", () => {
    it("processes every date whose cut-off has passed and none that has not", async () => {
      const w = await orderWorld(prisma);
      const admin = await loginAs(app, "admin@test.com");
      const wed = await place(admin, w); // locks Mon 5 Oct 16:00
      const thu = await place(admin, w, { deliveryDate: "2026-10-08" }); // locks Tue 6 Oct 16:00

      clock.set("2026-10-05T17:00:00+05:30");
      await processor.processDueDates();
      expect(await statusOf(wed.id)).toBe("CONFIRMED");
      expect(await statusOf(thu.id)).toBe("PLACED");

      clock.set("2026-10-06T17:00:00+05:30");
      await processor.processDueDates();
      expect(await statusOf(thu.id)).toBe("CONFIRMED");
    });

    it("does nothing before any cut-off", async () => {
      const { a } = await busyDay();
      await processor.processDueDates();
      expect(await statusOf(a.id)).toBe("PLACED");
    });
  });

  describe("manual trigger", () => {
    it("an admin can run it for a past cut-off; the response says what happened", async () => {
      const { admin, a } = await busyDay();
      clock.set(AFTER_CUTOFF);
      const res = await admin.post("/orders/process-cutoff").send({ date: DELIVERY_DATE });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ date: DELIVERY_DATE, cancelled: 1, confirmed: 3 });
      expect(await statusOf(a.id)).toBe("CONFIRMED");
      const again = await admin.post("/orders/process-cutoff").send({ date: DELIVERY_DATE });
      expect(again.body).toEqual({ date: DELIVERY_DATE, cancelled: 0, confirmed: 0 });
    });

    it("refuses a future cut-off with a clear message", async () => {
      const { admin } = await busyDay();
      const res = await admin.post("/orders/process-cutoff").send({ date: DELIVERY_DATE });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("CUTOFF_NOT_REACHED");
    });

    it("validates the date and is admin-only", async () => {
      const admin = await loginAs(app, "admin@test.com");
      expect((await admin.post("/orders/process-cutoff").send({ date: "07/10/2026" })).status).toBe(400);
      for (const who of ["kitchen@test.com", "dispatch@test.com", "driver@test.com"]) {
        expect((await (await loginAs(app, who)).post("/orders/process-cutoff").send({ date: DELIVERY_DATE })).status).toBe(403);
      }
    });
  });

  describe("admin override after confirmation moves the drop", () => {
    it("changing one order's time creates a new drop and leaves the other order's drop alone", async () => {
      const { admin, a, b } = await busyDay();
      clock.set(AFTER_CUTOFF);
      await processor.processDate(DELIVERY_DATE);
      const dropBefore = (await prisma.order.findUniqueOrThrow({ where: { id: a.id } })).dropId;

      await admin.patch(`/orders/${a.id}/override`).send({ deliveryTime: "16:00" }).expect(200);
      const oa = await prisma.order.findUniqueOrThrow({ where: { id: a.id } });
      const ob = await prisma.order.findUniqueOrThrow({ where: { id: b.id } });
      expect(oa.dropId).not.toBe(dropBefore);
      expect(ob.dropId).toBe(dropBefore); // b is unaffected
      expect((await prisma.drop.findUniqueOrThrow({ where: { id: oa.dropId! } })).deliveryTime).toBe("16:00");
    });

    it("moving the last order out of a drop removes the empty drop", async () => {
      const { admin, late } = await busyDay();
      clock.set(AFTER_CUTOFF);
      await processor.processDate(DELIVERY_DATE);
      const oldDrop = (await prisma.order.findUniqueOrThrow({ where: { id: late.id } })).dropId!;
      await admin.patch(`/orders/${late.id}/override`).send({ deliveryTime: "13:00" }).expect(200); // joins the 13:00 drop
      expect(await prisma.drop.findUnique({ where: { id: oldDrop } })).toBeNull();
      expect(await prisma.drop.count()).toBe(1);
    });
  });
});
