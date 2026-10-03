import { INestApplication } from "@nestjs/common";
import { seedDemoCatalogue } from "../src/demo/demo-catalogue";
import { rebaseDemoOrders } from "../src/demo/demo-orders";
import { DemoService } from "../src/demo/demo.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp, FakeClock, loginAs, resetAndSeedAuth } from "./helpers/app";

// Two possible "review days": a Saturday morning and a Wednesday late morning.
const SATURDAY = "2026-10-03T10:00:00+05:30";
const WEDNESDAY = "2026-10-07T11:00:00+05:30";

describe("demo data (e2e)", () => {
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
  });

  const seed = async (when: string) => {
    clock.set(when);
    await seedDemoCatalogue(prisma);
    return rebaseDemoOrders(prisma, new Date(when));
  };
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const plus = (iso: string, days: number) => ymd(new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000));

  describe("catalogue", () => {
    it("has the shape the brief asks for", async () => {
      await seedDemoCatalogue(prisma);
      expect(await prisma.company.count()).toBe(5);
      const companies = await prisma.company.findMany({ include: { domains: true, _count: { select: { employees: true } } } });
      for (const c of companies) expect(c._count.employees).toBeGreaterThanOrEqual(6);
      const domains = companies.flatMap((c) => c.domains.map((d) => d.domain));
      expect(new Set(domains).size).toBe(domains.length); // distinct domains
      expect(await prisma.dish.count()).toBeGreaterThanOrEqual(25);
      expect(await prisma.option.count()).toBeGreaterThanOrEqual(15);
      expect(await prisma.category.count({ where: { isSecret: true } })).toBe(1);
      expect(await prisma.optionGroup.count({ where: { required: true } })).toBeGreaterThan(0);
      expect(await prisma.optionGroup.count({ where: { required: false } })).toBeGreaterThan(0);

      // one company with a Sunday-to-Thursday week, some hiding, three price tiers in use
      expect(companies.some((c) => c.workingDays.includes(7) && !c.workingDays.includes(5))).toBe(true);
      expect(await prisma.companyHiddenCategory.count()).toBeGreaterThan(0);
      expect(await prisma.companyHiddenDish.count()).toBeGreaterThan(0);
      expect((await prisma.priceTier.findMany()).map((t) => t.name).sort()).toEqual(["Enterprise", "Partner", "Standard"]);
      expect((await prisma.priceTier.findMany({ where: { isDefault: true } })).map((t) => t.name)).toEqual(["Standard"]);
    });

    it("has derived tiers, a few typed-in prices, and a dish with no price on one tier", async () => {
      await seedDemoCatalogue(prisma);
      const tier = (name: string) => prisma.priceTier.findUniqueOrThrow({ where: { name } });
      expect(await tier("Standard")).toMatchObject({ derivationType: "COST_MULTIPLE", multiplierMilli: 2500 });
      expect(await tier("Enterprise")).toMatchObject({ derivationType: "TIER_PERCENT", percentBp: -1000 });
      expect(await prisma.dishPrice.count({ where: { isOverride: true, tier: { name: { in: ["Standard", "Enterprise"] } } } })).toBe(2);

      const rasmalai = await prisma.dish.findUniqueOrThrow({ where: { sku: "DES-04" } });
      const partner = await tier("Partner");
      expect(await prisma.dishPrice.count({ where: { dishId: rasmalai.id, tierId: partner.id } })).toBe(0);
      expect(await prisma.dishPrice.count({ where: { dishId: rasmalai.id } })).toBe(2);
      // every price is a whole number of cents, derived ones rounded up to a multiple of 5
      const derived = await prisma.dishPrice.findMany({ where: { isOverride: false } });
      expect(derived.every((p) => Number.isInteger(p.cents) && p.cents % 5 === 0)).toBe(true);
    });

    it("sells one group in sizes (Regular and Large), and every option in it can be served in both", async () => {
      await seedDemoCatalogue(prisma);
      const groups = await prisma.optionGroup.findMany({ where: { usesPortions: true }, include: { portions: { include: { portionSize: true } }, items: { include: { option: { include: { portions: true } } } } } });
      expect(groups.length).toBeGreaterThan(0);
      for (const g of groups) {
        expect(g.portions.map((p) => p.portionSize.name).sort()).toEqual(["Large", "Regular"]);
        for (const item of g.items) expect(item.option.portions).toHaveLength(2);
      }
    });

    it("is idempotent: running it again changes no counts and keeps option-group ids", async () => {
      await seedDemoCatalogue(prisma);
      const count = async () => ({
        dishes: await prisma.dish.count(), options: await prisma.option.count(), groups: await prisma.optionGroup.count(), prices: await prisma.dishPrice.count(),
        optionPrices: await prisma.optionPrice.count(), employees: await prisma.employee.count(), companies: await prisma.company.count(), domains: await prisma.companyDomain.count(),
        addresses: await prisma.companyAddress.count(), categoryItems: await prisma.categoryItem.count(), hidden: await prisma.companyHiddenDish.count(),
      });
      const groupIds = (await prisma.optionGroup.findMany({ orderBy: { id: "asc" } })).map((g) => g.id);
      const before = await count();
      await seedDemoCatalogue(prisma);
      expect(await count()).toEqual(before);
      expect((await prisma.optionGroup.findMany({ orderBy: { id: "asc" } })).map((g) => g.id)).toEqual(groupIds);
    });

    it("never creates more than the four documented staff accounts", async () => {
      await seed(SATURDAY);
      const emails = (await prisma.staff.findMany({ orderBy: { email: "asc" } })).map((s) => s.email);
      expect(emails).toEqual(["admin@test.com", "dispatch@test.com", "driver@test.com", "kitchen@test.com"]);
    });
  });

  describe.each([["a Saturday", SATURDAY], ["a Wednesday", WEDNESDAY]])("orders around %s", (_label, when) => {
    it("has orders for every day from today to a week ahead, and for the days before", async () => {
      const summary = await seed(when);
      const dates = new Set((await prisma.order.findMany({ select: { deliveryDate: true } })).map((o) => ymd(o.deliveryDate)));
      for (let offset = -6; offset <= 7; offset++) {
        // At least one company delivers every day of the week, so no day is empty.
        expect(dates.has(plus(summary.today, offset))).toBe(true);
      }
      expect([...dates].every((d) => d >= plus(summary.today, -6) && d <= plus(summary.today, 7))).toBe(true);
    });

    it("has orders in every status", async () => {
      const summary = await seed(when);
      for (const status of ["DRAFT", "PLACED", "CONFIRMED", "DELIVERED", "CANCELLED", "REJECTED"]) expect(summary.byStatus[status]).toBeGreaterThan(0);
    });

    it("gives the driver several drops today at different times, in different stages", async () => {
      const summary = await seed(when);
      const driver = await prisma.staff.findUniqueOrThrow({ where: { email: "driver@test.com" } });
      const mine = await prisma.drop.findMany({ where: { driverId: driver.id, deliveryDate: new Date(`${summary.today}T00:00:00Z`) } });
      expect(mine.length).toBeGreaterThanOrEqual(3);
      expect(new Set(mine.map((d) => d.deliveryTime)).size).toBeGreaterThanOrEqual(3);
      expect(mine.some((d) => d.status === "DELIVERED")).toBe(true);
      expect(mine.some((d) => d.status === "OUT_FOR_DELIVERY")).toBe(true);
    });

    it("today has confirmed orders with food waiting, being cooked and finished", async () => {
      const summary = await seed(when);
      const units = await prisma.prepUnit.findMany({ where: { combination: { line: { order: { deliveryDate: new Date(`${summary.today}T00:00:00Z`), status: "CONFIRMED" } } } } });
      const states = new Set(units.map((u) => u.status));
      expect(states.has("PENDING")).toBe(true);
      expect(states.has("STARTED")).toBe(true);
      expect(states.has("DONE")).toBe(true);
    });

    it("an order in a delivered drop is delivered, one in an open drop is not", async () => {
      await seed(when);
      const orders = await prisma.order.findMany({ where: { dropId: { not: null } }, include: { drop: true } });
      for (const o of orders) {
        expect(o.drop!.status === "DELIVERED").toBe(o.status === "DELIVERED");
        if (o.status === "DELIVERED") expect(o.drop!.deliveredAt).not.toBeNull();
        if (o.drop!.status === "OUT_FOR_DELIVERY") expect(o.outForDeliveryAt).not.toBeNull();
        if (o.drop!.status === "OPEN") expect(o.dispatchReadyAt).toBeNull();
      }
    });

    it("keeps the money consistent: lines add up, orders add up, invoices add up", async () => {
      await seed(when);
      const orders = await prisma.order.findMany({ include: { lines: { include: { combinations: true } } } });
      for (const o of orders) {
        const comboTotal = o.lines.flatMap((l) => l.combinations).reduce((sum, c) => sum + c.lineTotalCents, 0);
        expect(o.totalCents).toBe(comboTotal);
        for (const l of o.lines) {
          expect(l.combinations.reduce((sum, c) => sum + c.quantity, 0)).toBe(l.quantity);
          for (const c of l.combinations) expect(c.lineTotalCents).toBe(c.unitPriceCents * c.quantity);
        }
      }
      const invoices = await prisma.invoice.findMany({ include: { orders: true } });
      expect(invoices.length).toBeGreaterThan(0);
      for (const i of invoices) expect(i.totalCents).toBe(i.orders.reduce((sum, o) => sum + o.totalCents, 0));
      expect(invoices.some((i) => i.status === "PAID" && i.paidAt)).toBe(true);
    });

    it("prices every combination exactly as the order flow would: the dish's price on the company's tier plus each choice (and size) as recorded", async () => {
      await seed(when);
      const defaultTier = await prisma.priceTier.findFirstOrThrow({ where: { isDefault: true } });
      const orders = await prisma.order.findMany({ include: { company: true, lines: { include: { combinations: true } } } });
      let sized = 0;
      for (const o of orders) {
        for (const line of o.lines) {
          const price = await prisma.dishPrice.findUniqueOrThrow({ where: { tierId_dishId: { tierId: o.company.priceTierId ?? defaultTier.id, dishId: line.dishId } } });
          for (const c of line.combinations) {
            const picks = c.optionsSnapshot as { priceCents: number; portion: string | null }[];
            expect(c.unitPriceCents).toBe(price.cents + picks.reduce((sum, p) => sum + p.priceCents, 0));
            sized += picks.filter((p) => p.portion !== null).length;
          }
        }
      }
      expect(sized).toBeGreaterThan(0); // sizes really appear in the demo orders
    });

    it("follows the rules the real order flow enforces", async () => {
      const summary = await seed(when);
      const orders = await prisma.order.findMany({
        include: { company: { include: { holidays: true } }, employee: true, events: true, drop: true, lines: { include: { combinations: { include: { prepUnit: true } } } } },
      });
      for (const o of orders) {
        const weekday = new Date(`${ymd(o.deliveryDate)}T00:00:00Z`).getUTCDay() || 7;
        expect(o.company.workingDays).toContain(weekday); // only on days the company receives deliveries
        expect(o.company.holidays.map((h) => ymd(h.date))).not.toContain(ymd(o.deliveryDate));
        expect(o.employee.companyId).toBe(o.companyId);
        expect(o.events.some((e) => e.type === "CREATED")).toBe(true);
        expect(o.plannedKitchenReadyAt.getTime()).toBeLessThan(o.plannedDispatchReadyAt.getTime());
        if (o.status === "CONFIRMED" || o.status === "DELIVERED") {
          expect(o.drop).not.toBeNull();
          expect(o.lines.flatMap((l) => l.combinations).every((c) => c.prepUnit !== null)).toBe(true);
        } else {
          expect(o.lines.flatMap((l) => l.combinations).every((c) => c.prepUnit === null)).toBe(true);
        }
        if (o.status === "DELIVERED") {
          expect(typeof o.onTime).toBe("boolean");
          expect(o.deliveredAt).not.toBeNull();
          expect(o.deliveredAt!.getTime()).toBeLessThanOrEqual(clock.now().getTime());
        }
        if (o.status === "REJECTED") expect(o.rejectionReason).toBeTruthy();
        if (o.status === "CANCELLED") expect(o.events.some((e) => e.type === "CANCELLED")).toBe(true);
        expect(o.isDemo).toBe(true);
      }
      // a few of the delivered orders were late
      expect(orders.some((o) => o.status === "DELIVERED" && o.onTime === false)).toBe(true);
      expect(summary.orders).toBe(orders.length);
    });

    it("kitchen holidays and company holidays lie ahead of today", async () => {
      const summary = await seed(when);
      const kitchenHolidays = await prisma.kitchenHoliday.findMany();
      expect(kitchenHolidays.map((h) => ymd(h.date))).toEqual([plus(summary.today, 9)]);
      const holidays = await prisma.companyHoliday.findMany();
      expect(holidays.length).toBeGreaterThan(0);
      expect(holidays.every((h) => ymd(h.date) > summary.today)).toBe(true);
    });

    it("every saved draft can really be placed through the order flow (its saved request is valid)", async () => {
      await seed(when);
      const admin = await loginAs(app, "admin@test.com");
      const drafts = await prisma.order.findMany({ where: { status: "DRAFT" } });
      expect(drafts.length).toBeGreaterThan(0);
      for (const d of drafts) {
        const res = await admin.post(`/orders/${d.id}/place`);
        expect([201, 409]).toContain(res.status); // 409 only if its cut-off passed in the meantime
        if (res.status === 409) expect(res.body.code).toBe("CUTOFF_PASSED");
        else expect(res.body.status).toBe("PLACED");
      }
    });
  });

  describe("re-basing", () => {
    it("running it again on the same day gives the same data and no duplicates", async () => {
      const first = await seed(WEDNESDAY);
      const second = await rebaseDemoOrders(prisma, new Date(WEDNESDAY));
      expect(second).toEqual(first);
      expect(await prisma.order.count()).toBe(first.orders);
      expect(await prisma.drop.count()).toBe(first.drops);
      expect(await prisma.invoice.count()).toBe(first.invoices);
    });

    it("moving to a later day replaces the demo orders with a window around the new day", async () => {
      const first = await seed(WEDNESDAY);
      const later = await rebaseDemoOrders(prisma, new Date("2026-10-14T11:00:00+05:30"));
      expect(later.today).toBe("2026-10-14");
      const dates = (await prisma.order.findMany({ select: { deliveryDate: true } })).map((o) => ymd(o.deliveryDate)).sort();
      expect(dates[0] >= plus("2026-10-14", -6)).toBe(true); // ISO dates sort as text
      expect(dates[dates.length - 1] <= plus("2026-10-14", 7)).toBe(true);
      expect(await prisma.order.count({ where: { deliveryDate: new Date("2026-10-14T00:00:00Z") } })).toBeGreaterThan(0);
      expect(first.today).toBe("2026-10-07");
    });

    it("never deletes orders people made by hand, nor demo orders that are on a real invoice", async () => {
      await seed(SATURDAY);
      clock.set(SATURDAY);
      const admin = await loginAs(app, "admin@test.com");
      const employee = await prisma.employee.findFirstOrThrow({ where: { email: "aarav.sharma@acme.in" } });
      const dish = await prisma.dish.findUniqueOrThrow({ where: { sku: "SNK-03" } }); // no choices
      const real = await admin.post("/orders").send({ employeeId: employee.id, deliveryDate: "2026-10-12", lines: [{ dishId: dish.id, quantity: 4, combinations: [{ quantity: 4, selections: [] }] }] });
      expect(real.status).toBe(201);

      // a real invoice that includes one demo delivered order
      const demoDelivered = await prisma.order.findFirstOrThrow({ where: { isDemo: true, status: "DELIVERED", invoiceId: null } });
      const invoice = await admin.post("/invoices").send({ companyId: demoDelivered.companyId, orderIds: [demoDelivered.id] });
      expect(invoice.status).toBe(201);

      await rebaseDemoOrders(prisma, new Date("2026-10-10T10:00:00+05:30"));
      expect(await prisma.order.findUnique({ where: { id: real.body.id } })).not.toBeNull();
      expect((await prisma.order.findUniqueOrThrow({ where: { id: real.body.id } })).isDemo).toBe(false);
      expect(await prisma.order.findUnique({ where: { id: demoDelivered.id } })).not.toBeNull();
      const kept = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.body.id }, include: { orders: true } });
      expect(kept.totalCents).toBe(kept.orders.reduce((s, o) => s + o.totalCents, 0)); // still reconciles
    });
  });

  describe("the daily check and the admin button", () => {
    it("ensureToday builds the data when today has none, and does nothing when it does", async () => {
      clock.set(WEDNESDAY);
      const service = app.get(DemoService);
      const built = await service.ensureToday();
      expect(built).not.toBeNull();
      const orders = await prisma.order.count();
      expect(await service.ensureToday()).toBeNull();
      expect(await prisma.order.count()).toBe(orders);
      clock.set("2026-10-20T10:00:00+05:30"); // a new day arrives
      expect(await service.ensureToday()).not.toBeNull();
    });

    it("ensureToday re-bases on the very next day, even though the last refresh already created orders for that day", async () => {
      clock.set(WEDNESDAY);
      const service = app.get(DemoService);
      await service.ensureToday();
      // the refresh above made orders for Thursday as plain future work; none of it had progressed
      const thursday = "2026-10-08";
      expect(await prisma.drop.count({ where: { deliveryDate: new Date(`${thursday}T00:00:00Z`), status: { not: "OPEN" } } })).toBe(0);

      clock.set("2026-10-08T01:00:00+05:30"); // the nightly job on Thursday
      const rebuilt = await service.ensureToday();
      expect(rebuilt).not.toBeNull();
      expect(rebuilt!.today).toBe(thursday);
      // Thursday is now "today": some drops are delivered, some out, and so on
      const drops = await prisma.drop.findMany({ where: { deliveryDate: new Date(`${thursday}T00:00:00Z`) } });
      expect(drops.some((d) => d.status === "DELIVERED")).toBe(true);
      expect(drops.some((d) => d.status === "OUT_FOR_DELIVERY")).toBe(true);

      expect(await service.ensureToday()).toBeNull(); // and only once per day
    });

    it("pressing the admin button counts as the day's refresh", async () => {
      clock.set(WEDNESDAY);
      const admin = await loginAs(app, "admin@test.com");
      await admin.post("/demo/refresh");
      expect(await app.get(DemoService).ensureToday()).toBeNull();
    });

    it("POST /demo/refresh is for admin only and returns what it built", async () => {
      clock.set(WEDNESDAY);
      const admin = await loginAs(app, "admin@test.com");
      const res = await admin.post("/demo/refresh");
      expect(res.status).toBe(201);
      expect(res.body.today).toBe("2026-10-07");
      expect(res.body.orders).toBeGreaterThan(50);
      for (const who of ["kitchen@test.com", "dispatch@test.com", "driver@test.com"]) {
        expect((await (await loginAs(app, who)).post("/demo/refresh")).status).toBe(403);
      }
    });
  });

  describe("what each reviewer sees on the review day", () => {
    it("every dashboard and board has something real to show", async () => {
      await seed(WEDNESDAY);
      clock.set(WEDNESDAY);
      const admin = await (async () => loginAs(app, "admin@test.com"))();
      const dash = (await admin.get("/dashboard/admin")).body;
      expect(dash.activeOrders).toBeGreaterThan(0);
      expect(dash.uninvoiced.totalCents).toBeGreaterThan(0);
      expect(dash.upcoming.total).toBeGreaterThan(0);
      expect(dash.missingPrices.tiers.find((t: { name: string }) => t.name === "Partner").dishes).toBe(1); // Rasmalai

      const kitchen = await loginAs(app, "kitchen@test.com");
      const board = (await kitchen.get("/kitchen/board")).body;
      expect(board.totals.pending + board.totals.started + board.totals.done).toBeGreaterThan(5);

      const dispatch = (await (await loginAs(app, "dispatch@test.com")).get("/dispatch/board")).body;
      expect(dispatch.drops.length).toBeGreaterThanOrEqual(3);

      const mine = (await (await loginAs(app, "driver@test.com")).get("/driver/drops")).body;
      expect(mine.drops.length).toBeGreaterThanOrEqual(3);
      expect(mine.drops.map((d: { deliveryTime: string }) => d.deliveryTime)).toEqual([...mine.drops.map((d: { deliveryTime: string }) => d.deliveryTime)].sort());
    });
  });
});
