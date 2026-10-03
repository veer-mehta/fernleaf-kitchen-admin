import { INestApplication } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp, FakeClock, loginAs, resetAndSeedAuth } from "./helpers/app";
import { BEFORE_CUTOFF, orderWorld, tenBowls, type OrderWorld } from "./helpers/order-world";

describe("order list (e2e)", () => {
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

  type Agent = Awaited<ReturnType<typeof loginAs>>;
  const place = async (admin: Agent, w: OrderWorld, over: Record<string, unknown> = {}) => {
    const res = await admin.post("/orders").send(tenBowls(w, over));
    if (res.status !== 201) throw new Error(JSON.stringify(res.body));
    return res.body as { id: number };
  };
  const ids = (res: { body: { items: { id: number }[] } }) => res.body.items.map((o) => o.id);

  // Orders on 7, 8 and 9 Oct for Acme (asha), plus one on 7 Oct for Beta (ben).
  async function setup() {
    const w = await orderWorld(prisma);
    const admin = await loginAs(app, "admin@test.com");
    const beta = await w.f.company({ name: "Beta Foods" });
    await w.f.domain(beta.id, "beta.com");
    await w.f.address(beta.id);
    const ben = await w.f.employee(beta.id, "ben@beta.com");
    const wed = await place(admin, w);
    const thu = await place(admin, w, { deliveryDate: "2026-10-08" });
    const fri = await place(admin, w, { deliveryDate: "2026-10-09" });
    const betaOrder = await place(admin, w, { employeeId: ben.id });
    return { w, admin, wed, thu, fri, betaOrder, beta };
  }

  it("lists newest delivery date first, then newest order first, with a total for paging", async () => {
    const { admin, wed, thu, fri, betaOrder } = await setup();
    const res = await admin.get("/orders");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
    expect(ids(res)).toEqual([fri.id, thu.id, betaOrder.id, wed.id]);
    expect(res.body.items[0]).toMatchObject({
      status: "PLACED",
      deliveryDate: "2026-10-09",
      deliveryTime: "13:00",
      company: { name: "Acme" },
      employee: { name: "Employee" },
      totalCents: 10200,
      invoiced: false,
      itemCount: 10,
    });
  });

  it("filters by delivery date range, both ends included", async () => {
    const { admin, wed, thu, fri, betaOrder } = await setup();
    expect(ids(await admin.get("/orders?from=2026-10-08&to=2026-10-08"))).toEqual([thu.id]);
    expect(ids(await admin.get("/orders?from=2026-10-08"))).toEqual([fri.id, thu.id]);
    expect(new Set(ids(await admin.get("/orders?to=2026-10-07")))).toEqual(new Set([wed.id, betaOrder.id]));
    expect(ids(await admin.get("/orders?from=2026-10-10"))).toEqual([]);
  });

  it("filters by status", async () => {
    const { admin, thu } = await setup();
    await admin.post(`/orders/${thu.id}/cancel`).send({});
    expect(ids(await admin.get("/orders?status=CANCELLED"))).toEqual([thu.id]);
    expect((await admin.get("/orders?status=PLACED")).body.total).toBe(3);
    expect((await admin.get("/orders?status=BOGUS")).status).toBe(400);
  });

  it("filters by company", async () => {
    const { admin, betaOrder, beta } = await setup();
    expect(ids(await admin.get(`/orders?companyId=${beta.id}`))).toEqual([betaOrder.id]);
  });

  it("filters by whether the order is invoiced", async () => {
    const { w, admin, wed } = await setup();
    const invoice = await prisma.invoice.create({ data: { companyId: w.company.id, totalCents: 10200 } });
    await prisma.order.update({ where: { id: wed.id }, data: { invoiceId: invoice.id } });
    expect(ids(await admin.get("/orders?invoiced=true"))).toEqual([wed.id]);
    expect((await admin.get("/orders?invoiced=false")).body.total).toBe(3);
    expect((await admin.get("/orders")).body.items.find((o: { id: number }) => o.id === wed.id).invoiced).toBe(true);
  });

  it("searches by order number, employee name or email, and company name", async () => {
    const { admin, wed, betaOrder } = await setup();
    expect(ids(await admin.get(`/orders?search=${wed.id}`))).toContain(wed.id);
    expect(ids(await admin.get("/orders?search=BEN@beta"))).toEqual([betaOrder.id]);
    expect(ids(await admin.get("/orders?search=beta foods"))).toEqual([betaOrder.id]);
    expect((await admin.get("/orders?search=asha@acme")).body.total).toBe(3);
    expect((await admin.get("/orders?search=nobody-here")).body.total).toBe(0);
  });

  it("combines filters", async () => {
    const { admin, betaOrder } = await setup();
    const res = await admin.get("/orders?from=2026-10-07&to=2026-10-07&status=PLACED&search=beta");
    expect(ids(res)).toEqual([betaOrder.id]);
  });

  it("paginates on the server", async () => {
    const { admin } = await setup();
    const first = await admin.get("/orders?page=1&pageSize=3");
    const second = await admin.get("/orders?page=2&pageSize=3");
    expect(first.body.items).toHaveLength(3);
    expect(second.body.items).toHaveLength(1);
    expect(first.body.total).toBe(4);
    expect(new Set([...ids(first), ...ids(second)]).size).toBe(4); // no overlap
    expect((await admin.get("/orders?pageSize=500")).status).toBe(400);
  });

  it("kitchen and dispatch can read the list; the driver cannot", async () => {
    await setup();
    expect((await (await loginAs(app, "kitchen@test.com")).get("/orders")).status).toBe(200);
    expect((await (await loginAs(app, "dispatch@test.com")).get("/orders")).status).toBe(200);
    expect((await (await loginAs(app, "driver@test.com")).get("/orders")).status).toBe(403);
  });
});
