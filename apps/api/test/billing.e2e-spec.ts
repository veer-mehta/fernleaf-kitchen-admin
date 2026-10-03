import { INestApplication } from "@nestjs/common";
import { BillingService } from "../src/billing/billing.service";
import { CutoffProcessor } from "../src/orders/cutoff-processor.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp, FakeClock, loginAs, resetAndSeedAuth } from "./helpers/app";
import { AFTER_CUTOFF, BEFORE_CUTOFF, DELIVERY_DATE, TEN_BOWLS_TOTAL, orderWorld, tenBowls, type OrderWorld } from "./helpers/order-world";

describe("billing and invoices (e2e)", () => {
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

  // Acme (asha) has three orders, Beta (ben) has one. Everything is confirmed at the cut-off.
  async function setup() {
    const w = await orderWorld(prisma);
    const beta = await w.f.company({ name: "Beta Foods" });
    await w.f.domain(beta.id, "beta.com");
    await w.f.address(beta.id);
    const ben = await w.f.employee(beta.id, "ben@beta.com");
    const admin = await loginAs(app, "admin@test.com");
    const acme = [await place(admin, w), await place(admin, w), await place(admin, w)];
    const betaOrder = await place(admin, w, { employeeId: ben.id });
    clock.set(AFTER_CUTOFF);
    await processor.processDate(DELIVERY_DATE);
    return { w, admin, acme, betaOrder, beta };
  }
  const order = (id: number) => prisma.order.findUniqueOrThrow({ where: { id } });

  describe("orders waiting to be invoiced", () => {
    it("lists confirmed, not-yet-invoiced orders per company with totals", async () => {
      const { admin, acme, betaOrder, w, beta } = await setup();
      const res = await admin.get("/billing/uninvoiced");
      expect(res.status).toBe(200);
      expect(res.body.companies.map((c: { companyName: string }) => c.companyName)).toEqual(["Acme", "Beta Foods"]);
      const [acmeGroup, betaGroup] = res.body.companies;
      expect(acmeGroup).toMatchObject({ companyId: w.company.id, orderCount: 3, totalCents: 3 * TEN_BOWLS_TOTAL });
      expect(acmeGroup.orders.map((o: { id: number }) => o.id)).toEqual(acme);
      expect(acmeGroup.orders[0]).toMatchObject({ deliveryDate: DELIVERY_DATE, deliveryTime: "13:00", employeeName: "Employee", status: "CONFIRMED", totalCents: TEN_BOWLS_TOTAL });
      expect(betaGroup).toMatchObject({ companyId: beta.id, orderCount: 1 });
      expect(betaGroup.orders[0].id).toBe(betaOrder);
    });

    it("includes delivered orders but never drafts, placed, cancelled, rejected or already-invoiced ones", async () => {
      const { w, admin, acme } = await setup();
      const draft = await (async () => { clock.set(BEFORE_CUTOFF); return place(admin, w, { status: "DRAFT", deliveryDate: "2026-10-14" }); })();
      const placed = await place(admin, w, { deliveryDate: "2026-10-14" });
      const cancelled = await place(admin, w, { deliveryDate: "2026-10-14" });
      await admin.post(`/orders/${cancelled}/cancel`).send({});
      const rejected = await place(admin, w, { deliveryDate: "2026-10-14" });
      await admin.post(`/orders/${rejected}/reject`).send({ reason: "no" });
      await prisma.order.update({ where: { id: acme[0] }, data: { status: "DELIVERED" } });
      const invoice = await prisma.invoice.create({ data: { companyId: w.company.id, totalCents: 1 } });
      await prisma.order.update({ where: { id: acme[1] }, data: { invoiceId: invoice.id } });

      const res = await admin.get("/billing/uninvoiced");
      const ids = res.body.companies.flatMap((c: { orders: { id: number }[] }) => c.orders.map((o) => o.id));
      expect(ids).toContain(acme[0]); // delivered
      expect(ids).toContain(acme[2]);
      for (const hidden of [draft, placed, cancelled, rejected, acme[1]]) expect(ids).not.toContain(hidden);
    });

    it("can be limited to one company", async () => {
      const { admin, beta } = await setup();
      const res = await admin.get(`/billing/uninvoiced?companyId=${beta.id}`);
      expect(res.body.companies).toHaveLength(1);
      expect(res.body.companies[0].companyName).toBe("Beta Foods");
    });
  });

  describe("creating an invoice", () => {
    it("groups the chosen orders; the invoice total is the sum of their totals (money reconciles)", async () => {
      const { admin, acme, w } = await setup();
      const res = await admin.post("/invoices").send({ companyId: w.company.id, orderIds: [acme[0], acme[1]] });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: "OPEN", totalCents: 2 * TEN_BOWLS_TOTAL, company: { name: "Acme" }, paidAt: null });
      expect(res.body.orders.map((o: { id: number }) => o.id)).toEqual([acme[0], acme[1]]);

      const invoiceId = res.body.id;
      expect((await order(acme[0])).invoiceId).toBe(invoiceId);
      expect((await order(acme[2])).invoiceId).toBeNull(); // not selected
      // reconciliation, straight from the database
      const rows = await prisma.order.findMany({ where: { invoiceId } });
      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      expect(invoice.totalCents).toBe(rows.reduce((sum, o) => sum + o.totalCents, 0));
    });

    it("the invoiced orders leave the waiting list", async () => {
      const { admin, acme, w } = await setup();
      await admin.post("/invoices").send({ companyId: w.company.id, orderIds: acme }).expect(201);
      const res = await admin.get("/billing/uninvoiced");
      expect(res.body.companies.map((c: { companyName: string }) => c.companyName)).toEqual(["Beta Foods"]);
    });

    it("refuses an order of another company, and creates nothing", async () => {
      const { admin, acme, betaOrder, w } = await setup();
      const res = await admin.post("/invoices").send({ companyId: w.company.id, orderIds: [acme[0], betaOrder] });
      expect(res.status).toBe(400);
      expect(res.body.fields.orderIds).toBeDefined();
      expect(await prisma.invoice.count()).toBe(0);
      expect((await order(acme[0])).invoiceId).toBeNull();
    });

    it("refuses an order that is already on an invoice", async () => {
      const { admin, acme, w } = await setup();
      await admin.post("/invoices").send({ companyId: w.company.id, orderIds: [acme[0]] }).expect(201);
      const res = await admin.post("/invoices").send({ companyId: w.company.id, orderIds: [acme[0], acme[1]] });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("ORDER_ALREADY_INVOICED");
      expect(await prisma.invoice.count()).toBe(1);
      expect((await order(acme[1])).invoiceId).toBeNull(); // nothing half-done
    });

    it("refuses orders that are not billable (draft, placed, cancelled) and unknown orders", async () => {
      const { w, admin } = await setup();
      clock.set(BEFORE_CUTOFF);
      const futurePlaced = await place(admin, w, { deliveryDate: "2026-10-14" });
      const res = await admin.post("/invoices").send({ companyId: w.company.id, orderIds: [futurePlaced] });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("ORDER_NOT_BILLABLE");
      expect((await admin.post("/invoices").send({ companyId: w.company.id, orderIds: [99999] })).status).toBe(400);
      expect((await admin.post("/invoices").send({ companyId: 99999, orderIds: [1] })).status).toBe(400);
    });

    it("needs at least one order and no repeats", async () => {
      const { admin, acme, w } = await setup();
      expect((await admin.post("/invoices").send({ companyId: w.company.id, orderIds: [] })).status).toBe(400);
      expect((await admin.post("/invoices").send({ companyId: w.company.id, orderIds: [acme[0], acme[0]] })).status).toBe(400);
      expect((await admin.post("/invoices").send({ companyId: w.company.id, orderIds: [acme[0]], totalCents: 1 })).status).toBe(400); // no client totals
    });

    it("RF4: two invoices claiming the same order at the same moment: exactly one is created", async () => {
      const { admin, acme, w } = await setup();
      const other = await loginAs(app, "admin@test.com");
      const service = app.get(BillingService) as unknown as { loadBillable: (...a: unknown[]) => Promise<unknown> };
      const real = service.loadBillable.bind(service);
      let arrived = 0;
      let open!: () => void;
      const gate = new Promise<void>((resolve) => (open = resolve));
      const spy = jest.spyOn(service, "loadBillable").mockImplementation(async (...args: unknown[]) => {
        if (++arrived >= 2) open();
        await gate;
        return real(...args);
      });
      const body = { companyId: w.company.id, orderIds: [acme[0], acme[1]] };
      const results = await Promise.all([admin.post("/invoices").send(body), other.post("/invoices").send({ ...body, orderIds: [acme[1], acme[2]] })]);
      spy.mockRestore();
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await prisma.invoice.count()).toBe(1);
      const winner = results.find((r) => r.status === 201)!.body;
      expect(await prisma.order.count({ where: { invoiceId: winner.id } })).toBe(winner.orders.length);
      expect(await prisma.order.count({ where: { invoiceId: { not: null } } })).toBe(winner.orders.length); // the loser left nothing behind
    });
  });

  describe("invoice lifecycle", () => {
    async function invoiced() {
      const s = await setup();
      const res = await s.admin.post("/invoices").send({ companyId: s.w.company.id, orderIds: [s.acme[0], s.acme[1]] });
      return { ...s, invoiceId: res.body.id as number };
    }

    it("lists with company and status filters and pagination, and shows one invoice with its orders", async () => {
      const { admin, w, invoiceId, acme, beta, betaOrder } = await invoiced();
      await admin.post("/invoices").send({ companyId: beta.id, orderIds: [betaOrder] }).expect(201);
      await admin.post("/invoices").send({ companyId: w.company.id, orderIds: [acme[2]] }).expect(201);

      const all = await admin.get("/invoices");
      expect(all.body.total).toBe(3);
      expect(all.body.items[0].id).toBeGreaterThan(all.body.items[2].id); // newest first
      expect(all.body.items.find((i: { id: number }) => i.id === invoiceId)).toMatchObject({ company: { name: "Acme" }, status: "OPEN", orderCount: 2, totalCents: 2 * TEN_BOWLS_TOTAL });
      expect((await admin.get(`/invoices?companyId=${beta.id}`)).body.total).toBe(1);
      expect((await admin.get("/invoices?page=2&pageSize=2")).body.items).toHaveLength(1);
      expect((await admin.get("/invoices?status=PAID")).body.total).toBe(0);

      const one = await admin.get(`/invoices/${invoiceId}`);
      expect(one.body.orders).toHaveLength(2);
      expect((await admin.get("/invoices/99999")).status).toBe(404);
    });

    it("marks an invoice paid, once", async () => {
      const { admin, invoiceId } = await invoiced();
      clock.set("2026-10-20T10:00:00+05:30");
      const paid = await admin.post(`/invoices/${invoiceId}/pay`);
      expect(paid.status).toBe(201);
      expect(paid.body.status).toBe("PAID");
      expect(new Date(paid.body.paidAt)).toEqual(new Date("2026-10-20T10:00:00+05:30"));
      const again = await admin.post(`/invoices/${invoiceId}/pay`);
      expect(again.status).toBe(409);
      expect(again.body.code).toBe("INVOICE_NOT_OPEN");
    });

    it("an invoiced order is locked: cancel and override are refused until the invoice is voided", async () => {
      const { admin, acme } = await invoiced();
      expect((await admin.post(`/orders/${acme[0]}/cancel`).send({})).body.code).toBe("ORDER_INVOICED");
      expect((await admin.patch(`/orders/${acme[0]}/override`).send({ deliveryTime: "14:00" })).body.code).toBe("ORDER_INVOICED");
      expect((await order(acme[0])).status).toBe("CONFIRMED");
    });

    it("voiding unlinks the orders: they can be changed again and invoiced again", async () => {
      const { admin, acme, w, invoiceId } = await invoiced();
      const voided = await admin.post(`/invoices/${invoiceId}/void`);
      expect(voided.status).toBe(201);
      expect(voided.body.status).toBe("VOID");
      expect((await order(acme[0])).invoiceId).toBeNull();
      expect((await admin.get(`/invoices/${invoiceId}`)).body.orders).toEqual([]);

      const again = await admin.post("/invoices").send({ companyId: w.company.id, orderIds: [acme[0], acme[1]] });
      expect(again.status).toBe(201);
      expect(again.body.id).not.toBe(invoiceId);
      await admin.post(`/invoices/${again.body.id}/void`);
      expect((await admin.post(`/orders/${acme[0]}/cancel`).send({})).body.status).toBe("CANCELLED");
    });

    it("a paid invoice cannot be voided, and a void one cannot be voided or paid", async () => {
      const { admin, invoiceId } = await invoiced();
      await admin.post(`/invoices/${invoiceId}/pay`).expect(201);
      const voidPaid = await admin.post(`/invoices/${invoiceId}/void`);
      expect(voidPaid.status).toBe(409);
      expect(voidPaid.body.code).toBe("INVOICE_NOT_OPEN");

      const second = await admin.post("/invoices").send({ companyId: (await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).companyId, orderIds: [(await prisma.order.findFirstOrThrow({ where: { invoiceId: null, status: "CONFIRMED", company: { name: "Acme" } } })).id] });
      await admin.post(`/invoices/${second.body.id}/void`).expect(201);
      expect((await admin.post(`/invoices/${second.body.id}/void`)).status).toBe(409);
      expect((await admin.post(`/invoices/${second.body.id}/pay`)).status).toBe(409);
    });

    it("the paid invoice's orders stay locked", async () => {
      const { admin, acme, invoiceId } = await invoiced();
      await admin.post(`/invoices/${invoiceId}/pay`).expect(201);
      expect((await admin.post(`/orders/${acme[1]}/cancel`).send({})).body.code).toBe("ORDER_INVOICED");
    });

    it("unknown invoices are 404", async () => {
      const { admin } = await invoiced();
      expect((await admin.post("/invoices/99999/pay")).status).toBe(404);
      expect((await admin.post("/invoices/99999/void")).status).toBe(404);
    });
  });

  it("only admin can see or change billing", async () => {
    const { w, acme } = await setup();
    for (const who of ["kitchen@test.com", "dispatch@test.com", "driver@test.com"]) {
      const agent = await loginAs(app, who);
      expect((await agent.get("/billing/uninvoiced")).status).toBe(403);
      expect((await agent.get("/invoices")).status).toBe(403);
      expect((await agent.post("/invoices").send({ companyId: w.company.id, orderIds: [acme[0]] })).status).toBe(403);
      expect((await agent.post("/invoices/1/pay")).status).toBe(403);
    }
  });
});
