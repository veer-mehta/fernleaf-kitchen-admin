import { INestApplication } from "@nestjs/common";
import { MenuService } from "../src/menu/menu.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp, loginAs, resetAndSeedAuth } from "./helpers/app";
import { fixtures } from "./helpers/fixtures";

describe("employees (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let f: ReturnType<typeof fixtures>;

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

  // A company that owns the given domains (domain rows are what employee emails are checked against).
  async function companyWithDomains(name: string, domains: string[], tierId?: number) {
    const company = await f.company({ name, priceTierId: tierId });
    for (const domain of domains) await prisma.companyDomain.create({ data: { companyId: company.id, domain } });
    return company;
  }

  it("creates an employee with permission flags, allergies and diet", async () => {
    const admin = await loginAs(app, "admin@test.com");
    const acme = await companyWithDomains("Acme", ["acme.com"]);
    const nuts = await prisma.allergen.create({ data: { name: "Nuts" } });
    const vegan = await prisma.dietaryTag.create({ data: { name: "Vegan" } });
    const res = await admin.post("/employees").send({
      companyId: acme.id,
      email: "Asha@ACME.com",
      name: "Asha",
      canChooseAddress: true,
      allergenIds: [nuts.id],
      dietaryTagIds: [vegan.id],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      email: "asha@acme.com",
      canChooseAddress: true,
      canChangeTime: false,
      canChangePackaging: false,
      active: true,
      company: { id: acme.id, name: "Acme" },
    });
    expect(res.body.allergens.map((a: { name: string }) => a.name)).toEqual(["Nuts"]);
    expect(res.body.dietaryTags.map((a: { name: string }) => a.name)).toEqual(["Vegan"]);
  });

  it("the email must use one of the company's domains", async () => {
    const admin = await loginAs(app, "admin@test.com");
    const acme = await companyWithDomains("Acme", ["acme.com", "acme.org"]);
    const res = await admin.post("/employees").send({ companyId: acme.id, email: "x@other.com", name: "X" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("EMAIL_DOMAIN_MISMATCH");
    expect(res.body.fields.email).toContain("acme.com");
    expect((await admin.post("/employees").send({ companyId: acme.id, email: "y@acme.org", name: "Y" })).status).toBe(201);
  });

  it("emails are unique", async () => {
    const admin = await loginAs(app, "admin@test.com");
    const acme = await companyWithDomains("Acme", ["acme.com"]);
    await admin.post("/employees").send({ companyId: acme.id, email: "a@acme.com", name: "A" });
    const res = await admin.post("/employees").send({ companyId: acme.id, email: "A@acme.com", name: "A2" });
    expect(res.status).toBe(409);
    expect(res.body.fields.email).toBeDefined();
  });

  it("rejects an unknown company, allergen or malformed email", async () => {
    const admin = await loginAs(app, "admin@test.com");
    const acme = await companyWithDomains("Acme", ["acme.com"]);
    const noCompany = await admin.post("/employees").send({ companyId: 999, email: "a@acme.com", name: "A" });
    expect(noCompany.status).toBe(400);
    expect(noCompany.body.fields.companyId).toBeDefined();
    const noAllergen = await admin.post("/employees").send({ companyId: acme.id, email: "a@acme.com", name: "A", allergenIds: [999] });
    expect(noAllergen.body.fields.allergenIds).toBeDefined();
    expect((await admin.post("/employees").send({ companyId: acme.id, email: "nope", name: "A" })).status).toBe(400);
  });

  it("edits flags and replaces allergies without touching the rest", async () => {
    const admin = await loginAs(app, "admin@test.com");
    const acme = await companyWithDomains("Acme", ["acme.com"]);
    const nuts = await prisma.allergen.create({ data: { name: "Nuts" } });
    const soy = await prisma.allergen.create({ data: { name: "Soy" } });
    const e = (await admin.post("/employees").send({ companyId: acme.id, email: "a@acme.com", name: "A", allergenIds: [nuts.id] })).body;
    const res = await admin.patch(`/employees/${e.id}`).send({ canChangeTime: true, allergenIds: [soy.id] });
    expect(res.body.canChangeTime).toBe(true);
    expect(res.body.allergens.map((a: { name: string }) => a.name)).toEqual(["Soy"]);
    expect(res.body.name).toBe("A");
  });

  it("deactivates an employee", async () => {
    const admin = await loginAs(app, "admin@test.com");
    const acme = await companyWithDomains("Acme", ["acme.com"]);
    const e = (await admin.post("/employees").send({ companyId: acme.id, email: "a@acme.com", name: "A" })).body;
    expect((await admin.patch(`/employees/${e.id}`).send({ active: false })).body.active).toBe(false);
  });

  describe("moving between companies", () => {
    it("needs an email that fits the new company", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const acme = await companyWithDomains("Acme", ["acme.com"]);
      const beta = await companyWithDomains("Beta", ["beta.com"]);
      const e = (await admin.post("/employees").send({ companyId: acme.id, email: "a@acme.com", name: "A" })).body;

      const stale = await admin.patch(`/employees/${e.id}`).send({ companyId: beta.id });
      expect(stale.status).toBe(400);
      expect(stale.body.code).toBe("EMAIL_DOMAIN_MISMATCH");

      const moved = await admin.patch(`/employees/${e.id}`).send({ companyId: beta.id, email: "a@beta.com" });
      expect(moved.status).toBe(200);
      expect(moved.body.company.name).toBe("Beta");
    });

    it("the owner of a company cannot be moved away", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const acme = await companyWithDomains("Acme", ["acme.com"]);
      const beta = await companyWithDomains("Beta", ["beta.com"]);
      const e = (await admin.post("/employees").send({ companyId: acme.id, email: "a@acme.com", name: "A" })).body;
      await prisma.company.update({ where: { id: acme.id }, data: { ownerEmployeeId: e.id } });
      const res = await admin.patch(`/employees/${e.id}`).send({ companyId: beta.id, email: "a@beta.com" });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("OWNER_CANNOT_MOVE");
    });

    it("moving changes which rules apply: the menu now uses the new company's price tier", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const standard = await f.tier("Standard", true);
      const enterprise = await f.tier("Enterprise");
      const acme = await companyWithDomains("Acme", ["acme.com"], enterprise.id);
      const beta = await companyWithDomains("Beta", ["beta.com"]); // default tier
      const dish = await f.dish("D1");
      const category = await f.category("Bowls");
      await f.categoryItem(category.id, dish.id);
      await f.dishPrice(standard.id, dish.id, 300);
      await f.dishPrice(enterprise.id, dish.id, 500);

      const e = (await admin.post("/employees").send({ companyId: acme.id, email: "a@acme.com", name: "A" })).body;
      const menu = app.get(MenuService);
      expect((await menu.forEmployee(e.id)).categories[0].dishes[0].priceCents).toBe(500);
      await admin.patch(`/employees/${e.id}`).send({ companyId: beta.id, email: "a@beta.com" });
      expect((await menu.forEmployee(e.id)).categories[0].dishes[0].priceCents).toBe(300);
    });
  });

  it("lists with company filter, search and pagination", async () => {
    const admin = await loginAs(app, "admin@test.com");
    const acme = await companyWithDomains("Acme", ["acme.com"]);
    const beta = await companyWithDomains("Beta", ["beta.com"]);
    for (let i = 1; i <= 5; i++) await f.employee(acme.id, `p${i}@acme.com`);
    await f.employee(beta.id, "zed@beta.com");

    const byCompany = await admin.get(`/employees?companyId=${acme.id}&page=2&pageSize=2`);
    expect(byCompany.body.items).toHaveLength(2);
    expect(byCompany.body.total).toBe(5);
    const search = await admin.get("/employees?search=ZED");
    expect(search.body.items.map((x: { email: string }) => x.email)).toEqual(["zed@beta.com"]);
  });

  it("404 for an unknown employee", async () => {
    const admin = await loginAs(app, "admin@test.com");
    expect((await admin.get("/employees/999")).status).toBe(404);
    expect((await admin.patch("/employees/999").send({ name: "X" })).status).toBe(404);
  });

  it("only admin can read or change employees (dispatch has no employee access)", async () => {
    for (const who of ["kitchen@test.com", "dispatch@test.com", "driver@test.com"]) {
      const agent = await loginAs(app, who);
      expect((await agent.get("/employees")).status).toBe(403);
      expect((await agent.post("/employees").send({ companyId: 1, email: "a@b.com", name: "A" })).status).toBe(403);
    }
  });
});
