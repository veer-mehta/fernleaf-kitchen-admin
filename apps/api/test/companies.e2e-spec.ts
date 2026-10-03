import { INestApplication } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp, loginAs, resetAndSeedAuth } from "./helpers/app";
import { fixtures } from "./helpers/fixtures";

describe("companies (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let f: ReturnType<typeof fixtures>;
  type Agent = Awaited<ReturnType<typeof loginAs>>;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    f = fixtures(prisma);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetAndSeedAuth(prisma);
  });

  const body = (over: Record<string, unknown> = {}) => ({
    name: "Acme",
    domains: ["acme.com"],
    addresses: [{ label: "HQ", line1: "1 Main St", city: "Pune", postalCode: "411001" }],
    ...over,
  });
  const create = async (admin: Agent, over: Record<string, unknown> = {}) => {
    const res = await admin.post("/companies").send(body(over));
    if (res.status !== 201) throw new Error(JSON.stringify(res.body));
    return res.body;
  };

  describe("create and read", () => {
    it("creates a company with the documented defaults", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const res = await admin.post("/companies").send(body());
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        name: "Acme",
        workingDays: [1, 2, 3, 4, 5],
        deliveryTime: "13:00",
        deliveryMinutes: 60,
        defaultPackaging: "STANDARD",
        priceTier: null,
        ownerEmployee: null,
        defaultDriver: null,
      });
      expect(res.body.domains.map((d: { domain: string }) => d.domain)).toEqual(["acme.com"]);
      expect(res.body.addresses).toHaveLength(1);
    });

    it("normalises domains: trimmed, lower-case, no leading @", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const res = await admin.post("/companies").send(body({ domains: [" ACME.com ", "@Acme.Co.In"] }));
      expect(res.body.domains.map((d: { domain: string }) => d.domain).sort()).toEqual(["acme.co.in", "acme.com"]);
    });

    it("rejects public email domains", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const res = await admin.post("/companies").send(body({ domains: ["gmail.com"] }));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("PUBLIC_DOMAIN");
      expect(res.body.fields.domains).toContain("gmail.com");
    });

    it("two companies cannot claim the same domain", async () => {
      const admin = await loginAs(app, "admin@test.com");
      await create(admin);
      const res = await admin.post("/companies").send(body({ name: "Rival", domains: ["ACME.com"] }));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("DOMAIN_TAKEN");
      expect(await prisma.company.count()).toBe(1); // nothing half-created
    });

    it("rejects the same domain twice in one request and malformed domains", async () => {
      const admin = await loginAs(app, "admin@test.com");
      expect((await admin.post("/companies").send(body({ domains: ["a.com", "A.com"] }))).status).toBe(400);
      const bad = await admin.post("/companies").send(body({ domains: ["not a domain"] }));
      expect(bad.status).toBe(400);
    });

    it("needs at least one domain and one address", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const res = await admin.post("/companies").send(body({ domains: [], addresses: [] }));
      expect(res.status).toBe(400);
      expect(res.body.fields.domains).toBeDefined();
      expect(res.body.fields.addresses).toBeDefined();
    });

    it("rejects a duplicate company name", async () => {
      const admin = await loginAs(app, "admin@test.com");
      await create(admin);
      const res = await admin.post("/companies").send(body({ domains: ["other.com"] }));
      expect(res.status).toBe(409);
      expect(res.body.fields.name).toBeDefined();
    });

    it("lists with search, pagination, domains and employee counts", async () => {
      const admin = await loginAs(app, "admin@test.com");
      for (const [name, domain] of [["Acme", "acme.com"], ["Beta", "beta.com"], ["Gamma", "gamma.com"]]) {
        await create(admin, { name, domains: [domain] });
      }
      const acme = await prisma.company.findUniqueOrThrow({ where: { name: "Acme" } });
      await f.employee(acme.id, "a@acme.com");
      await f.employee(acme.id, "b@acme.com");

      const page = await admin.get("/companies?page=1&pageSize=2");
      expect(page.body.items).toHaveLength(2);
      expect(page.body.total).toBe(3);

      const search = await admin.get("/companies?search=acm");
      expect(search.body.items).toHaveLength(1);
      expect(search.body.items[0]).toMatchObject({ name: "Acme", employeeCount: 2, domains: ["acme.com"] });
    });

    it("404 for an unknown company", async () => {
      const admin = await loginAs(app, "admin@test.com");
      expect((await admin.get("/companies/999")).status).toBe(404);
    });
  });

  describe("update", () => {
    it("changes delivery defaults and working week", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const c = await create(admin);
      const res = await admin.patch(`/companies/${c.id}`).send({
        workingDays: [0 + 7, 1, 2, 3, 4],
        deliveryTime: "12:30",
        deliveryMinutes: 90,
        defaultPackaging: "INSULATED",
        driverInstructions: "Use gate 2",
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ deliveryTime: "12:30", deliveryMinutes: 90, defaultPackaging: "INSULATED" });
      expect(res.body.workingDays.sort()).toEqual([1, 2, 3, 4, 7]);
      expect(res.body.name).toBe("Acme"); // untouched
    });

    it("rejects bad times, days and minutes", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const c = await create(admin);
      const res = await admin.patch(`/companies/${c.id}`).send({ deliveryTime: "25:99", workingDays: [0], deliveryMinutes: -5 });
      expect(res.status).toBe(400);
      for (const k of ["deliveryTime", "workingDays.0", "deliveryMinutes"]) expect(res.body.fields[k]).toBeDefined();
    });

    it("sets a price tier, which must exist", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const c = await create(admin);
      const tier = await f.tier("Enterprise");
      expect((await admin.patch(`/companies/${c.id}`).send({ priceTierId: tier.id })).body.priceTier.name).toBe("Enterprise");
      const bad = await admin.patch(`/companies/${c.id}`).send({ priceTierId: 999 });
      expect(bad.status).toBe(400);
      expect(bad.body.fields.priceTierId).toBeDefined();
      expect((await admin.patch(`/companies/${c.id}`).send({ priceTierId: null })).body.priceTier).toBeNull();
    });

    it("the default driver must be someone with driver access", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const c = await create(admin);
      const driver = await prisma.staff.findUniqueOrThrow({ where: { email: "driver@test.com" } });
      const kitchen = await prisma.staff.findUniqueOrThrow({ where: { email: "kitchen@test.com" } });
      expect((await admin.patch(`/companies/${c.id}`).send({ defaultDriverId: driver.id })).body.defaultDriver.id).toBe(driver.id);
      const bad = await admin.patch(`/companies/${c.id}`).send({ defaultDriverId: kitchen.id });
      expect(bad.status).toBe(400);
      expect(bad.body.fields.defaultDriverId).toBeDefined();
    });

    it("the owner must be one of the company's own employees", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const c = await create(admin);
      const other = await f.company({ name: "Other" });
      const mine = await f.employee(c.id, "me@acme.com");
      const theirs = await f.employee(other.id, "them@other.com");
      expect((await admin.patch(`/companies/${c.id}`).send({ ownerEmployeeId: mine.id })).body.ownerEmployee.id).toBe(mine.id);
      const bad = await admin.patch(`/companies/${c.id}`).send({ ownerEmployeeId: theirs.id });
      expect(bad.status).toBe(400);
      expect(bad.body.fields.ownerEmployeeId).toBeDefined();
    });
  });

  describe("domains, addresses, holidays", () => {
    it("adds and removes domains with the same rules", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const c = await create(admin);
      const added = await admin.post(`/companies/${c.id}/domains`).send({ domain: "acme.org" });
      expect(added.status).toBe(201);
      expect((await admin.post(`/companies/${c.id}/domains`).send({ domain: "yahoo.com" })).body.code).toBe("PUBLIC_DOMAIN");
      const other = await create(admin, { name: "Beta", domains: ["beta.com"] });
      expect((await admin.post(`/companies/${other.id}/domains`).send({ domain: "acme.org" })).status).toBe(409);

      await admin.delete(`/companies/${c.id}/domains/${added.body.id}`).expect(200);
      expect((await admin.get(`/companies/${c.id}`)).body.domains).toHaveLength(1);
    });

    it("cannot remove the last domain, or one that employees use", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const c = await create(admin);
      const only = c.domains[0];
      const last = await admin.delete(`/companies/${c.id}/domains/${only.id}`);
      expect(last.status).toBe(400);
      expect(last.body.code).toBe("LAST_DOMAIN");

      const second = await admin.post(`/companies/${c.id}/domains`).send({ domain: "acme.org" });
      await f.employee(c.id, "x@acme.org");
      const used = await admin.delete(`/companies/${c.id}/domains/${second.body.id}`);
      expect(used.status).toBe(409);
      expect(used.body.code).toBe("DOMAIN_IN_USE");
    });

    it("manages addresses but keeps at least one", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const c = await create(admin);
      const added = await admin
        .post(`/companies/${c.id}/addresses`)
        .send({ label: "Plant", line1: "9 Ring Rd", city: "Pune", postalCode: "411002" });
      expect(added.status).toBe(201);
      const edited = await admin.patch(`/companies/${c.id}/addresses/${added.body.id}`).send({ city: "Mumbai" });
      expect(edited.body.city).toBe("Mumbai");
      await admin.delete(`/companies/${c.id}/addresses/${added.body.id}`).expect(200);
      const last = await admin.delete(`/companies/${c.id}/addresses/${c.addresses[0].id}`);
      expect(last.status).toBe(400);
      expect(last.body.code).toBe("LAST_ADDRESS");
    });

    it("an address of another company cannot be edited through this one", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const a = await create(admin);
      const b = await create(admin, { name: "Beta", domains: ["beta.com"] });
      const res = await admin.patch(`/companies/${a.id}/addresses/${b.addresses[0].id}`).send({ city: "X" });
      expect(res.status).toBe(404);
    });

    it("manages company holidays; duplicates are rejected", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const c = await create(admin);
      const h = await admin.post(`/companies/${c.id}/holidays`).send({ date: "2026-10-12", name: "Founders day" });
      expect(h.status).toBe(201);
      expect((await admin.post(`/companies/${c.id}/holidays`).send({ date: "2026-10-12" })).status).toBe(409);
      expect((await admin.get(`/companies/${c.id}`)).body.holidays).toEqual([{ id: h.body.id, date: "2026-10-12", name: "Founders day" }]);
      await admin.delete(`/companies/${c.id}/holidays/${h.body.id}`).expect(200);
      expect((await admin.get(`/companies/${c.id}`)).body.holidays).toEqual([]);
    });
  });

  describe("hidden menu items", () => {
    it("replaces the hidden categories and dishes", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const c = await create(admin);
      const cat = await f.category("Desserts");
      const d1 = await f.dish("D1");
      const d2 = await f.dish("D2");
      await admin.put(`/companies/${c.id}/hidden`).send({ categoryIds: [cat.id], dishIds: [d1.id] }).expect(200);
      let detail = (await admin.get(`/companies/${c.id}`)).body;
      expect(detail.hiddenCategoryIds).toEqual([cat.id]);
      expect(detail.hiddenDishIds).toEqual([d1.id]);

      await admin.put(`/companies/${c.id}/hidden`).send({ categoryIds: [], dishIds: [d2.id] }).expect(200);
      detail = (await admin.get(`/companies/${c.id}`)).body;
      expect(detail.hiddenCategoryIds).toEqual([]);
      expect(detail.hiddenDishIds).toEqual([d2.id]);
    });

    it("rejects unknown ids", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const c = await create(admin);
      const res = await admin.put(`/companies/${c.id}/hidden`).send({ categoryIds: [999], dishIds: [888] });
      expect(res.status).toBe(400);
      expect(res.body.fields.categoryIds).toBeDefined();
      expect(res.body.fields.dishIds).toBeDefined();
    });
  });

  describe("who may do what", () => {
    it("dispatch can read companies but not change them; kitchen and driver cannot even read", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const c = await create(admin);
      const dispatch = await loginAs(app, "dispatch@test.com");
      expect((await dispatch.get("/companies")).status).toBe(200);
      expect((await dispatch.get(`/companies/${c.id}`)).status).toBe(200);
      expect((await dispatch.post("/companies").send(body({ name: "X", domains: ["x.com"] }))).status).toBe(403);
      expect((await dispatch.patch(`/companies/${c.id}`).send({ name: "Y" })).status).toBe(403);
      expect((await (await loginAs(app, "kitchen@test.com")).get("/companies")).status).toBe(403);
      expect((await (await loginAs(app, "driver@test.com")).get("/companies")).status).toBe(403);
    });

    it("dispatch can list drivers for assignment", async () => {
      const dispatch = await loginAs(app, "dispatch@test.com");
      const res = await dispatch.get("/drivers");
      expect(res.status).toBe(200);
      // Admin holds every permission (including driver access), so is listed too; kitchen and dispatch are not.
      const emails = res.body.map((d: { email: string }) => d.email);
      expect(emails).toContain("driver@test.com");
      expect(emails).not.toContain("kitchen@test.com");
      expect(emails).not.toContain("dispatch@test.com");
      expect((await (await loginAs(app, "kitchen@test.com")).get("/drivers")).status).toBe(403);
    });
  });
});
