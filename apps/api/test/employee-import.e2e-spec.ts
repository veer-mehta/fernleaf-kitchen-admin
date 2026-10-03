import { INestApplication } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp, loginAs, resetAndSeedAuth } from "./helpers/app";
import { fixtures } from "./helpers/fixtures";

describe("employee CSV import (e2e)", () => {
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

  async function acme() {
    const company = await f.company({ name: "Acme" });
    await f.domain(company.id, "acme.com");
    await prisma.allergen.create({ data: { name: "Nuts" } });
    await prisma.dietaryTag.create({ data: { name: "Vegan" } });
    return company;
  }
  const importCsv = async (companyId: number, csv: string) => (await loginAs(app, "admin@test.com")).post(`/companies/${companyId}/employees/import`).send({ csv });

  it("imports every good row with its flags, allergies and dietary preferences", async () => {
    const company = await acme();
    const res = await importCsv(company.id, [
      "name,email,canChooseAddress,canChangeTime,canChangePackaging,allergies,dietaryPreferences",
      "Asha Rao,asha@acme.com,yes,no,no,Nuts,Vegan",
      "Ben Cole,ben@acme.com,,,true,,",
    ].join("\n"));
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ total: 2, imported: 2, failed: 0, errors: [] });

    const asha = await prisma.employee.findUniqueOrThrow({ where: { email: "asha@acme.com" }, include: { allergens: { include: { allergen: true } }, dietaryTags: { include: { dietaryTag: true } } } });
    expect(asha).toMatchObject({ companyId: company.id, name: "Asha Rao", active: true, canChooseAddress: true, canChangeTime: false, canChangePackaging: false });
    expect(asha.allergens.map((a) => a.allergen.name)).toEqual(["Nuts"]);
    expect(asha.dietaryTags.map((t) => t.dietaryTag.name)).toEqual(["Vegan"]);
    expect((await prisma.employee.findUniqueOrThrow({ where: { email: "ben@acme.com" } })).canChangePackaging).toBe(true);
  });

  it("reports row-level errors without rejecting the whole file: good rows go in, bad rows come back with their number and reason", async () => {
    const company = await acme();
    await f.employee(company.id, "taken@acme.com");
    const res = await importCsv(company.id, [
      "name,email",
      "Good One,good@acme.com",
      ",noname@acme.com",
      "Wrong Domain,x@elsewhere.com",
      "Taken,taken@acme.com",
      "Dup A,dup@acme.com",
      "Dup B,DUP@acme.com",
      "Last Good,last@acme.com",
    ].join("\n"));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ total: 7, imported: 3, failed: 4 });
    expect(res.body.errors.map((e: { row: number }) => e.row)).toEqual([2, 3, 4, 6]);
    expect(res.body.errors[1]).toMatchObject({ row: 3, name: "Wrong Domain", email: "x@elsewhere.com" });
    expect(res.body.errors[1].message).toMatch(/acme\.com/);
    expect(res.body.errors[2].message).toMatch(/already/i);
    expect(res.body.errors[3].message).toMatch(/row 5/);

    const emails = (await prisma.employee.findMany({ where: { companyId: company.id }, orderBy: { id: "asc" } })).map((e) => e.email);
    expect(emails).toEqual(["taken@acme.com", "good@acme.com", "dup@acme.com", "last@acme.com"]);
  });

  it("importing the same file twice adds nobody the second time (every row is reported as already present)", async () => {
    const company = await acme();
    const csv = "name,email\nAsha,asha@acme.com\nBen,ben@acme.com\n";
    await importCsv(company.id, csv);
    const again = await importCsv(company.id, csv);
    expect(again.body).toMatchObject({ imported: 0, failed: 2 });
    expect(await prisma.employee.count()).toBe(2);
  });

  it("refuses a broken FILE as a whole, with a message the person can act on", async () => {
    const company = await acme();
    for (const [csv, expected] of [
      ["name\nAsha\n", /email/],
      ["name,emial\nAsha,a@acme.com\n", /emial/],
      ["name,email\n", /no employees/],
    ] as const) {
      const res = await importCsv(company.id, csv);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_CSV");
      expect(res.body.fields.csv).toMatch(expected);
    }
    expect(await prisma.employee.count()).toBe(0);
  });

  it("refuses more than 1000 rows, and a file too large for one request", async () => {
    const company = await acme();
    const rows = Array.from({ length: 1001 }, (_, i) => `P${i},p${i}@acme.com`).join("\n");
    expect((await importCsv(company.id, `name,email\n${rows}`)).body.fields.csv).toMatch(/1000/);
    expect((await importCsv(company.id, "x".repeat(100_000))).status).toBe(400);
    expect(await prisma.employee.count()).toBe(0);
  });

  it("imports a full 1000 rows in reasonable time", async () => {
    const company = await acme();
    const rows = Array.from({ length: 1000 }, (_, i) => `Person ${i},person${i}@acme.com`).join("\n");
    const started = Date.now();
    const res = await importCsv(company.id, `name,email\n${rows}`);
    expect(res.body).toMatchObject({ imported: 1000, failed: 0 });
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it("reads real-world CSV: byte-order mark, Windows line endings, quoted commas", async () => {
    const company = await acme();
    const res = await importCsv(company.id, '﻿Name,Email\r\n"Rao, Asha",asha@acme.com\r\n');
    expect(res.body).toMatchObject({ imported: 1, failed: 0 });
    expect((await prisma.employee.findUniqueOrThrow({ where: { email: "asha@acme.com" } })).name).toBe("Rao, Asha");
  });

  it("an unknown company is 404; only admin may import", async () => {
    const company = await acme();
    const admin = await loginAs(app, "admin@test.com");
    expect((await admin.post("/companies/99999/employees/import").send({ csv: "name,email\nA,a@acme.com" })).status).toBe(404);
    for (const who of ["kitchen@test.com", "dispatch@test.com", "driver@test.com"]) {
      const agent = await loginAs(app, who);
      expect((await agent.post(`/companies/${company.id}/employees/import`).send({ csv: "name,email\nA,a@acme.com" })).status).toBe(403);
    }
    expect(await prisma.employee.count()).toBe(0);
  });

  it("imported employees are real employees: they show in the list and have a menu", async () => {
    const company = await acme();
    await importCsv(company.id, "name,email\nAsha,asha@acme.com\n");
    const admin = await loginAs(app, "admin@test.com");
    const list = await admin.get(`/employees?companyId=${company.id}`);
    expect(list.body.items.map((e: { email: string }) => e.email)).toEqual(["asha@acme.com"]);
    expect((await admin.get(`/employees/${list.body.items[0].id}/menu`)).status).toBe(200);
  });
});
