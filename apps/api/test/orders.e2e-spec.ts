import { INestApplication } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp, FakeClock, loginAs, resetAndSeedAuth } from "./helpers/app";
import {
  AFTER_CUTOFF, BEFORE_CUTOFF, TEN_BOWLS_TOTAL, createOrderDeskStaff, orderWorld, tenBowls,
} from "./helpers/order-world";

describe("orders: placing, editing, cancelling (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let clock: FakeClock;

  beforeAll(async () => {
    ({ app, prisma, clock } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetAndSeedAuth(prisma);
    clock.set(BEFORE_CUTOFF);
  });

  async function placed(over: Record<string, unknown> = {}, flags = {}) {
    const w = await orderWorld(prisma, flags);
    const admin = await loginAs(app, "admin@test.com");
    const res = await admin.post("/orders").send(tenBowls(w, over));
    if (res.status !== 201) throw new Error(JSON.stringify(res.body));
    return { w, admin, order: res.body };
  }

  describe("placing", () => {
    it("places an order: server-computed totals, snapshots and a timeline", async () => {
      const { order } = await placed();
      expect(order.status).toBe("PLACED");
      expect(order.totalCents).toBe(TEN_BOWLS_TOTAL); // 10200
      expect(order.company.name).toBe("Acme");
      expect(order.deliveryTime).toBe("13:00"); // the company default
      expect(order.address.label).toBe("HQ");

      const [brown, jeera] = order.lines[0].combinations;
      expect([brown.quantity, brown.unitPriceCents, brown.lineTotalCents]).toEqual([6, 1000, 6000]);
      expect([jeera.quantity, jeera.unitPriceCents, jeera.lineTotalCents]).toEqual([4, 1050, 4200]);
      expect(brown.options).toEqual([{ groupName: "Rice", optionName: "Brown rice", portion: null, priceCents: 0 }]);
      expect(order.lines[0].dishName).toBe("Dish BOWL");

      expect(order.timeline.map((e: { type: string }) => e.type)).toEqual(["CREATED", "PLACED"]);
      expect(order.timeline[0].actor).toBe("Asha Admin");
    });

    it("returns the saved request so the order can be reopened for editing", async () => {
      const { w, order } = await placed();
      expect(order.request.lines[0].combinations[0]).toEqual({ quantity: 6, selections: [{ groupId: w.group.id, optionId: w.brown.id }] });
    });

    it("the order total equals the sum of its lines, and the cut-off and plan are stored", async () => {
      const { order } = await placed();
      const sum = order.lines.reduce((s: number, l: { lineTotalCents: number }) => s + l.lineTotalCents, 0);
      expect(order.totalCents).toBe(sum);
      expect(new Date(order.cutoffAt)).toEqual(new Date("2026-10-05T16:00:00+05:30"));
      expect(new Date(order.plannedDispatchReadyAt)).toEqual(new Date("2026-10-07T12:00:00+05:30"));
      expect(new Date(order.plannedKitchenReadyAt)).toEqual(new Date("2026-10-07T11:30:00+05:30"));
    });

    it("RF3: a client-supplied total (or any unknown field) is refused, never trusted", async () => {
      const w = await orderWorld(prisma);
      const admin = await loginAs(app, "admin@test.com");
      const res = await admin.post("/orders").send(tenBowls(w, { totalCents: 1 }));
      expect(res.status).toBe(400);
      expect(await prisma.order.count()).toBe(0);
    });

    it("a draft can be saved; it has no PLACED event", async () => {
      const { order } = await placed({ status: "DRAFT" });
      expect(order.status).toBe("DRAFT");
      expect(order.timeline.map((e: { type: string }) => e.type)).toEqual(["CREATED"]);
    });

    it("only staff with orders:write can place orders", async () => {
      const w = await orderWorld(prisma);
      for (const who of ["kitchen@test.com", "dispatch@test.com", "driver@test.com"]) {
        const agent = await loginAs(app, who);
        expect((await agent.post("/orders").send(tenBowls(w))).status).toBe(403);
      }
      expect(await prisma.order.count()).toBe(0);
    });
  });

  describe("delivery date rules", () => {
    it("refuses a weekend for a Mon-Fri company, naming the day", async () => {
      const w = await orderWorld(prisma);
      const admin = await loginAs(app, "admin@test.com");
      const res = await admin.post("/orders").send(tenBowls(w, { deliveryDate: "2026-10-10" })); // Saturday
      expect(res.status).toBe(400);
      expect(res.body.fields.deliveryDate).toMatch(/Saturday/);
    });

    it("refuses a company holiday", async () => {
      const w = await orderWorld(prisma);
      await prisma.companyHoliday.create({ data: { companyId: w.company.id, date: new Date("2026-10-07T00:00:00Z"), name: "Founders day" } });
      const admin = await loginAs(app, "admin@test.com");
      const res = await admin.post("/orders").send(tenBowls(w));
      expect(res.status).toBe(400);
      expect(res.body.fields.deliveryDate).toMatch(/Founders day/);
    });

    it("the company calendar does not move the cut-off (a company holiday does not extend it)", async () => {
      const w = await orderWorld(prisma);
      // Monday 5 Oct is a company holiday, but the KITCHEN still locks Wednesday's orders Monday 16:00.
      await prisma.companyHoliday.create({ data: { companyId: w.company.id, date: new Date("2026-10-05T00:00:00Z") } });
      const admin = await loginAs(app, "admin@test.com");
      clock.set(AFTER_CUTOFF);
      const res = await admin.post("/orders").send(tenBowls(w));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("CUTOFF_PASSED");
    });

    it("kitchen holidays move the cut-off earlier (Tue 6 closed -> Wednesday locks Friday 2 Oct 16:00)", async () => {
      const w = await orderWorld(prisma);
      await prisma.kitchenHoliday.create({ data: { date: new Date("2026-10-06T00:00:00Z") } });
      const admin = await loginAs(app, "admin@test.com");
      clock.set("2026-10-02T16:00:00+05:30");
      expect((await admin.post("/orders").send(tenBowls(w))).body.code).toBe("CUTOFF_PASSED");
      clock.set("2026-10-02T15:59:00+05:30");
      expect((await admin.post("/orders").send(tenBowls(w))).status).toBe(201);
    });
  });

  describe("cut-off lock", () => {
    it("creating is refused from the cut-off instant, for everyone including admin", async () => {
      const w = await orderWorld(prisma);
      const admin = await loginAs(app, "admin@test.com");
      clock.set("2026-10-05T15:59:59+05:30");
      expect((await admin.post("/orders").send(tenBowls(w))).status).toBe(201);
      clock.set(AFTER_CUTOFF);
      const res = await admin.post("/orders").send(tenBowls(w));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("CUTOFF_PASSED");
    });

    it("RF1: the kitchen date logic is independent of the server's time zone", async () => {
      const w = await orderWorld(prisma);
      const admin = await loginAs(app, "admin@test.com");
      // 10:29 UTC on Mon 5 Oct is 15:59 in Kolkata: still open. 10:30 UTC is 16:00 in Kolkata: locked.
      clock.set("2026-10-05T10:29:00Z");
      expect((await admin.post("/orders").send(tenBowls(w))).status).toBe(201);
      clock.set("2026-10-05T10:30:00Z");
      expect((await admin.post("/orders").send(tenBowls(w))).status).toBe(409);
    });

    it("editing and cancelling after the cut-off: refused for staff without override, allowed to cancel for admin", async () => {
      const { w, admin, order } = await placed();
      await createOrderDeskStaff(prisma);
      const desk = await loginAs(app, "desk@test.com");
      clock.set(AFTER_CUTOFF);

      const edit = await desk.patch(`/orders/${order.id}`).send(tenBowls(w));
      expect(edit.status).toBe(409);
      expect(edit.body.code).toBe("CUTOFF_PASSED");
      expect((await desk.post(`/orders/${order.id}/cancel`).send({})).body.code).toBe("CUTOFF_PASSED");

      // Not even admin may rewrite the dishes now ...
      expect((await admin.patch(`/orders/${order.id}`).send(tenBowls(w))).status).toBe(409);
      // ... but admin can still cancel.
      const cancelled = await admin.post(`/orders/${order.id}/cancel`).send({ reason: "Customer called" });
      expect(cancelled.status).toBe(201);
      expect(cancelled.body.status).toBe("CANCELLED");
    });

    it("before the cut-off, a writer without override rights can edit and cancel", async () => {
      const { w, order } = await placed();
      await createOrderDeskStaff(prisma);
      const desk = await loginAs(app, "desk@test.com");
      expect((await desk.patch(`/orders/${order.id}`).send(tenBowls(w))).status).toBe(200);
      expect((await desk.post(`/orders/${order.id}/cancel`).send({})).body.status).toBe("CANCELLED");
    });
  });

  describe("what may be ordered", () => {
    it("refuses a dish that has no price on the employee's tier", async () => {
      const w = await orderWorld(prisma);
      await prisma.dishPrice.deleteMany({ where: { dishId: w.dish.id } });
      const admin = await loginAs(app, "admin@test.com");
      const res = await admin.post("/orders").send(tenBowls(w));
      expect(res.status).toBe(400);
      expect(res.body.fields["lines.0.dishId"]).toBeDefined();
    });

    it("refuses a dish hidden from the employee's company", async () => {
      const w = await orderWorld(prisma);
      await w.f.hideDish(w.company.id, w.dish.id);
      const admin = await loginAs(app, "admin@test.com");
      expect((await admin.post("/orders").send(tenBowls(w))).body.fields["lines.0.dishId"]).toBeDefined();
    });

    it("refuses a dish that does not exist", async () => {
      const w = await orderWorld(prisma);
      const admin = await loginAs(app, "admin@test.com");
      const body = tenBowls(w);
      body.lines[0].dishId = 9999;
      expect((await admin.post("/orders").send(body)).status).toBe(400);
    });

    it("reports combination problems against the right line and field", async () => {
      const w = await orderWorld(prisma);
      const admin = await loginAs(app, "admin@test.com");
      const body = tenBowls(w);
      body.lines[0].combinations[1].quantity = 3; // 6 + 3 != 10
      const res = await admin.post("/orders").send(body);
      expect(res.status).toBe(400);
      expect(res.body.fields["lines.0.combinations"]).toMatch(/add up/i);
    });

    it("refuses an option from outside the dish's groups and a missing required choice", async () => {
      const w = await orderWorld(prisma);
      const stray = await w.f.option("Stray");
      const admin = await loginAs(app, "admin@test.com");
      const body = tenBowls(w);
      body.lines[0].combinations[0].selections = [{ groupId: w.group.id, optionId: stray.id }];
      body.lines[0].combinations[1].selections = [];
      const res = await admin.post("/orders").send(body);
      expect(res.body.fields["lines.0.combinations.0.selections"]).toMatch(/not offered/i);
      expect(res.body.fields["lines.0.combinations.1.selections"]).toMatch(/Rice/);
    });

    it("refuses zero and fractional quantities", async () => {
      const w = await orderWorld(prisma);
      const admin = await loginAs(app, "admin@test.com");
      for (const bad of [0, -1, 2.5]) {
        const body = tenBowls(w);
        body.lines[0].quantity = bad;
        expect((await admin.post("/orders").send(body)).status).toBe(400);
      }
    });

    it("enforces the dish's minimum order quantity", async () => {
      const w = await orderWorld(prisma);
      await prisma.dish.update({ where: { id: w.dish.id }, data: { minOrderQty: 12 } });
      const admin = await loginAs(app, "admin@test.com");
      const res = await admin.post("/orders").send(tenBowls(w));
      expect(res.body.fields["lines.0.quantity"]).toMatch(/minimum/i);
    });

    it("refuses an inactive employee and an unknown employee", async () => {
      const w = await orderWorld(prisma);
      const admin = await loginAs(app, "admin@test.com");
      await prisma.employee.update({ where: { id: w.employee.id }, data: { active: false } });
      expect((await admin.post("/orders").send(tenBowls(w))).body.code).toBe("EMPLOYEE_INACTIVE");
      expect((await admin.post("/orders").send(tenBowls(w, { employeeId: 9999 }))).status).toBe(400);
    });

    it("an allergy conflict is a warning, not a block", async () => {
      const w = await orderWorld(prisma);
      const nuts = await prisma.allergen.create({ data: { name: "Nuts" } });
      await prisma.dishAllergen.create({ data: { dishId: w.dish.id, allergenId: nuts.id } });
      await prisma.employeeAllergen.create({ data: { employeeId: w.employee.id, allergenId: nuts.id } });
      const admin = await loginAs(app, "admin@test.com");
      const res = await admin.post("/orders").send(tenBowls(w));
      expect(res.status).toBe(201);
      expect(res.body.warnings.join(" ")).toMatch(/Nuts/);
    });
  });

  describe("delivery details and employee permissions", () => {
    it("without permission flags the company defaults are forced; asking for different ones is refused", async () => {
      const w = await orderWorld(prisma);
      const admin = await loginAs(app, "admin@test.com");
      const res = await admin.post("/orders").send(tenBowls(w, { addressId: w.plant.id, deliveryTime: "15:00", packaging: "ECO" }));
      expect(res.status).toBe(400);
      for (const f of ["addressId", "deliveryTime", "packaging"]) expect(res.body.fields[f]).toBeDefined();
      // asking for the defaults explicitly is fine
      const ok = await admin.post("/orders").send(tenBowls(w, { addressId: w.hq.id, deliveryTime: "13:00", packaging: "STANDARD" }));
      expect(ok.status).toBe(201);
    });

    it("with the flags, a different address, time and packaging are accepted and the plan follows the time", async () => {
      const w = await orderWorld(prisma, { canChooseAddress: true, canChangeTime: true, canChangePackaging: true });
      const admin = await loginAs(app, "admin@test.com");
      const res = await admin.post("/orders").send(tenBowls(w, { addressId: w.plant.id, deliveryTime: "15:00", packaging: "ECO" }));
      expect(res.status).toBe(201);
      expect(res.body.address.label).toBe("Plant");
      expect(res.body.packaging).toBe("ECO");
      expect(new Date(res.body.plannedKitchenReadyAt)).toEqual(new Date("2026-10-07T13:30:00+05:30"));
    });

    it("an address of another company is refused even with the flag", async () => {
      const w = await orderWorld(prisma, { canChooseAddress: true });
      const other = await w.f.company({ name: "Other" });
      const foreign = await w.f.address(other.id, "Foreign");
      const admin = await loginAs(app, "admin@test.com");
      expect((await admin.post("/orders").send(tenBowls(w, { addressId: foreign.id }))).body.fields.addressId).toBeDefined();
    });
  });

  describe("history never changes (RF5)", () => {
    it("repricing, renaming, deactivating and moving the employee leave a placed order untouched", async () => {
      const { w, admin, order } = await placed();
      const before = (await admin.get(`/orders/${order.id}`)).body;

      await prisma.dishPrice.updateMany({ where: { dishId: w.dish.id }, data: { cents: 9999 } });
      await prisma.optionPrice.updateMany({ data: { cents: 777 } });
      await prisma.dish.update({ where: { id: w.dish.id }, data: { name: "Renamed", sku: "NEWSKU", active: false } });
      await prisma.option.updateMany({ data: { name: "Renamed option", active: false } });
      const other = await w.f.company({ name: "Beta" });
      await w.f.domain(other.id, "beta.com");
      await prisma.employee.update({ where: { id: w.employee.id }, data: { companyId: other.id, email: "asha@beta.com" } });

      const after = (await admin.get(`/orders/${order.id}`)).body;
      expect(after.totalCents).toBe(TEN_BOWLS_TOTAL);
      expect(after.company.name).toBe("Acme");
      expect(after.lines).toEqual(before.lines);
      expect(after.lines[0].dishName).toBe("Dish BOWL");
      expect(after.lines[0].sku).toBe("BOWL");
    });

    it("an order stays with the company it was placed for, in the database too", async () => {
      const { w, order } = await placed();
      const other = await w.f.company({ name: "Beta" });
      await prisma.employee.update({ where: { id: w.employee.id }, data: { companyId: other.id } });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).companyId).toBe(w.company.id);
    });
  });

  describe("editing", () => {
    it("replaces the lines, recomputes the totals and adds an EDITED event", async () => {
      const { w, admin, order } = await placed();
      const body = tenBowls(w);
      body.lines[0].quantity = 5;
      body.lines[0].combinations = [{ quantity: 5, selections: [{ groupId: w.group.id, optionId: w.jeera.id }] }];
      const res = await admin.patch(`/orders/${order.id}`).send(body);
      expect(res.status).toBe(200);
      expect(res.body.totalCents).toBe(5 * 1050);
      expect(res.body.lines).toHaveLength(1);
      expect(res.body.timeline.map((e: { type: string }) => e.type)).toEqual(["CREATED", "PLACED", "EDITED"]);
      expect(await prisma.orderLine.count()).toBe(1);
      expect(await prisma.orderLineCombination.count()).toBe(1);
    });

    it("a failed edit leaves the order exactly as it was", async () => {
      const { w, admin, order } = await placed();
      const bad = tenBowls(w);
      bad.lines[0].combinations[0].quantity = 1;
      expect((await admin.patch(`/orders/${order.id}`).send(bad)).status).toBe(400);
      const after = (await admin.get(`/orders/${order.id}`)).body;
      expect(after.totalCents).toBe(TEN_BOWLS_TOTAL);
      expect(after.lines[0].combinations).toHaveLength(2);
    });

    it("cannot move an order to another employee, or back from placed to draft", async () => {
      const { w, admin, order } = await placed();
      const other = await w.f.employee(w.company.id, "other@acme.com");
      expect((await admin.patch(`/orders/${order.id}`).send(tenBowls(w, { employeeId: other.id }))).body.code).toBe("EMPLOYEE_CANNOT_CHANGE");
      expect((await admin.patch(`/orders/${order.id}`).send(tenBowls(w, { status: "DRAFT" }))).body.code).toBe("INVALID_TRANSITION");
    });

    it("a confirmed order's dishes cannot be edited", async () => {
      const { w, admin, order } = await placed();
      await prisma.order.update({ where: { id: order.id }, data: { status: "CONFIRMED" } });
      expect((await admin.patch(`/orders/${order.id}`).send(tenBowls(w))).body.code).toBe("ORDER_NOT_EDITABLE");
    });
  });

  describe("placing a draft", () => {
    it("places it and re-prices it at that moment (RF5: a stale draft cannot keep old prices)", async () => {
      const { w, admin, order } = await placed({ status: "DRAFT" });
      expect(order.totalCents).toBe(TEN_BOWLS_TOTAL);
      await prisma.dishPrice.updateMany({ where: { dishId: w.dish.id }, data: { cents: 2000 } });

      const res = await admin.post(`/orders/${order.id}/place`);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("PLACED");
      expect(res.body.totalCents).toBe(6 * 2000 + 4 * 2050);
      expect(res.body.timeline.map((e: { type: string }) => e.type)).toEqual(["CREATED", "PLACED"]);
    });

    it("RF4: placing twice is refused the second time", async () => {
      const { admin, order } = await placed({ status: "DRAFT" });
      expect((await admin.post(`/orders/${order.id}/place`)).status).toBe(201);
      const again = await admin.post(`/orders/${order.id}/place`);
      expect(again.status).toBe(409);
      expect(again.body.code).toBe("ORDER_NOT_DRAFT");
    });

    it("RF4: two simultaneous place requests produce exactly one placed order and one clear refusal", async () => {
      const { admin, order } = await placed({ status: "DRAFT" });
      const results = await Promise.all([admin.post(`/orders/${order.id}/place`), admin.post(`/orders/${order.id}/place`)]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409]);
      const events = await prisma.orderEvent.count({ where: { orderId: order.id, type: "PLACED" } });
      expect(events).toBe(1);
    });

    it("a draft cannot be placed after the cut-off", async () => {
      const { admin, order } = await placed({ status: "DRAFT" });
      clock.set(AFTER_CUTOFF);
      expect((await admin.post(`/orders/${order.id}/place`)).body.code).toBe("CUTOFF_PASSED");
    });
  });

  describe("cancelling and rejecting", () => {
    it("cancels a draft and a placed order; a second cancel is refused", async () => {
      const { admin, order } = await placed();
      const first = await admin.post(`/orders/${order.id}/cancel`).send({ reason: "Changed mind" });
      expect(first.body.status).toBe("CANCELLED");
      expect(first.body.timeline.at(-1)).toMatchObject({ type: "CANCELLED", meta: { reason: "Changed mind" } });
      const second = await admin.post(`/orders/${order.id}/cancel`).send({});
      expect(second.status).toBe(409);
      expect(second.body.code).toBe("ORDER_NOT_CANCELLABLE");
    });

    it("an admin can cancel a confirmed order", async () => {
      const { admin, order } = await placed();
      await prisma.order.update({ where: { id: order.id }, data: { status: "CONFIRMED" } });
      expect((await admin.post(`/orders/${order.id}/cancel`).send({})).body.status).toBe("CANCELLED");
    });

    it("admin rejects a placed order with a reason (terminal)", async () => {
      const { admin, order } = await placed();
      expect((await admin.post(`/orders/${order.id}/reject`).send({})).status).toBe(400); // reason required
      const res = await admin.post(`/orders/${order.id}/reject`).send({ reason: "Cannot cook this" });
      expect(res.body.status).toBe("REJECTED");
      expect(res.body.rejectionReason).toBe("Cannot cook this");
      expect((await admin.post(`/orders/${order.id}/cancel`).send({})).status).toBe(409);
    });

    it("only a placed order can be rejected, and only with override rights", async () => {
      const { admin, order } = await placed({ status: "DRAFT" });
      expect((await admin.post(`/orders/${order.id}/reject`).send({ reason: "x" })).body.code).toBe("ORDER_NOT_PLACED");
      await createOrderDeskStaff(prisma);
      const desk = await loginAs(app, "desk@test.com");
      expect((await desk.post(`/orders/${order.id}/reject`).send({ reason: "x" })).status).toBe(403);
    });

    it("RF4: two simultaneous cancels give one success and one refusal", async () => {
      const { admin, order } = await placed();
      const results = await Promise.all([admin.post(`/orders/${order.id}/cancel`).send({}), admin.post(`/orders/${order.id}/cancel`).send({})]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await prisma.orderEvent.count({ where: { orderId: order.id, type: "CANCELLED" } })).toBe(1);
    });
  });

  describe("admin override of delivery details", () => {
    it("changes the delivery time and recomputes the plan; the timeline records it", async () => {
      const { admin, order } = await placed();
      await prisma.order.update({ where: { id: order.id }, data: { status: "CONFIRMED" } });
      const res = await admin.patch(`/orders/${order.id}/override`).send({ deliveryTime: "14:30" });
      expect(res.status).toBe(200);
      expect(res.body.deliveryTime).toBe("14:30");
      expect(new Date(res.body.plannedDispatchReadyAt)).toEqual(new Date("2026-10-07T13:30:00+05:30"));
      expect(new Date(res.body.plannedKitchenReadyAt)).toEqual(new Date("2026-10-07T13:00:00+05:30"));
      expect(res.body.timeline.at(-1)).toMatchObject({ type: "OVERRIDDEN", actor: "Asha Admin" });
    });

    it("changes the address and packaging, but only to the company's own addresses", async () => {
      const { w, admin, order } = await placed();
      const res = await admin.patch(`/orders/${order.id}/override`).send({ addressId: w.plant.id, packaging: "INSULATED" });
      expect(res.body.address.label).toBe("Plant");
      expect(res.body.packaging).toBe("INSULATED");
      const other = await w.f.company({ name: "Other" });
      const foreign = await w.f.address(other.id, "Foreign");
      expect((await admin.patch(`/orders/${order.id}/override`).send({ addressId: foreign.id })).status).toBe(400);
    });

    it("needs at least one change, override rights, and an unlocked (non-invoiced, live) order", async () => {
      const { w, admin, order } = await placed();
      expect((await admin.patch(`/orders/${order.id}/override`).send({})).status).toBe(400);

      await createOrderDeskStaff(prisma);
      const desk = await loginAs(app, "desk@test.com");
      expect((await desk.patch(`/orders/${order.id}/override`).send({ deliveryTime: "14:00" })).status).toBe(403);

      const invoice = await prisma.invoice.create({ data: { companyId: w.company.id, totalCents: order.totalCents } });
      await prisma.order.update({ where: { id: order.id }, data: { invoiceId: invoice.id } });
      expect((await admin.patch(`/orders/${order.id}/override`).send({ deliveryTime: "14:00" })).body.code).toBe("ORDER_INVOICED");
      expect((await admin.post(`/orders/${order.id}/cancel`).send({})).body.code).toBe("ORDER_INVOICED");
    });
  });

  it("GET /orders/:id: any reader can see an order; unknown is 404", async () => {
    const { order } = await placed();
    expect((await (await loginAs(app, "kitchen@test.com")).get(`/orders/${order.id}`)).status).toBe(200);
    expect((await (await loginAs(app, "dispatch@test.com")).get(`/orders/${order.id}`)).status).toBe(200);
    expect((await (await loginAs(app, "driver@test.com")).get(`/orders/${order.id}`)).status).toBe(403);
    expect((await (await loginAs(app, "admin@test.com")).get("/orders/9999")).status).toBe(404);
  });
});

