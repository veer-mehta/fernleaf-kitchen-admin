import { INestApplication } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp, loginAs, resetAndSeedAuth } from "./helpers/app";
import { fixtures } from "./helpers/fixtures";

describe("categories (e2e)", () => {
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

  it("creates categories that are listed in creation order", async () => {
    const admin = await loginAs(app, "admin@test.com");
    await admin.post("/categories").send({ name: "Bowls" });
    await admin.post("/categories").send({ name: "Desserts", isSecret: true });
    const list = await admin.get("/categories");
    expect(list.body.map((c: { name: string }) => c.name)).toEqual(["Bowls", "Desserts"]);
    expect(list.body[0]).toMatchObject({ active: true, isSecret: false, items: [] });
    expect(list.body[1].isSecret).toBe(true);
  });

  it("renames, deactivates and flips secret", async () => {
    const admin = await loginAs(app, "admin@test.com");
    const c = await admin.post("/categories").send({ name: "Bowls" });
    const res = await admin.patch(`/categories/${c.body.id}`).send({ name: "Big Bowls", active: false, isSecret: true });
    expect(res.body).toMatchObject({ name: "Big Bowls", active: false, isSecret: true });
  });

  it("reorders categories", async () => {
    const admin = await loginAs(app, "admin@test.com");
    const a = await admin.post("/categories").send({ name: "A" });
    const b = await admin.post("/categories").send({ name: "B" });
    const c = await admin.post("/categories").send({ name: "C" });
    const res = await admin.put("/categories/order").send({ ids: [c.body.id, a.body.id, b.body.id] });
    expect(res.status).toBe(200);
    const list = await admin.get("/categories");
    expect(list.body.map((x: { name: string }) => x.name)).toEqual(["C", "A", "B"]);
  });

  it("rejects reordering with an unknown category", async () => {
    const admin = await loginAs(app, "admin@test.com");
    const a = await admin.post("/categories").send({ name: "A" });
    const res = await admin.put("/categories/order").send({ ids: [a.body.id, 999] });
    expect(res.status).toBe(400);
  });

  it("replaces a category's items in the order given, with active flags", async () => {
    const admin = await loginAs(app, "admin@test.com");
    const c = await admin.post("/categories").send({ name: "Bowls" });
    const d1 = await f.dish("D1");
    const d2 = await f.dish("D2");
    const d3 = await f.dish("D3");

    await admin.put(`/categories/${c.body.id}/items`).send({ items: [{ dishId: d3.id }, { dishId: d1.id, active: false }] });
    let items = (await admin.get("/categories")).body[0].items;
    expect(items.map((i: { sku: string; active: boolean }) => [i.sku, i.active])).toEqual([
      ["D3", true],
      ["D1", false],
    ]);

    await admin.put(`/categories/${c.body.id}/items`).send({ items: [{ dishId: d2.id }] });
    items = (await admin.get("/categories")).body[0].items;
    expect(items.map((i: { sku: string }) => i.sku)).toEqual(["D2"]);
  });

  it("rejects an unknown dish and a dish listed twice", async () => {
    const admin = await loginAs(app, "admin@test.com");
    const c = await admin.post("/categories").send({ name: "Bowls" });
    const d1 = await f.dish("D1");
    const unknown = await admin.put(`/categories/${c.body.id}/items`).send({ items: [{ dishId: 999 }] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.fields["items.0.dishId"]).toBeDefined();
    const dup = await admin.put(`/categories/${c.body.id}/items`).send({ items: [{ dishId: d1.id }, { dishId: d1.id }] });
    expect(dup.status).toBe(400);
  });

  it("deleting a category removes its items and company hiding but not the dishes", async () => {
    const admin = await loginAs(app, "admin@test.com");
    const c = await admin.post("/categories").send({ name: "Bowls" });
    const dish = await f.dish("D1");
    await f.categoryItem(c.body.id, dish.id);
    const company = await f.company();
    await f.hideCategory(company.id, c.body.id);

    expect((await admin.delete(`/categories/${c.body.id}`)).status).toBe(200);
    expect(await prisma.categoryItem.count()).toBe(0);
    expect(await prisma.companyHiddenCategory.count()).toBe(0);
    expect(await prisma.dish.count()).toBe(1);
  });

  it("missing category is 404", async () => {
    const admin = await loginAs(app, "admin@test.com");
    expect((await admin.patch("/categories/999").send({ name: "X" })).status).toBe(404);
    expect((await admin.delete("/categories/999")).status).toBe(404);
    expect((await admin.put("/categories/999/items").send({ items: [] })).status).toBe(404);
  });

  it("kitchen can read categories but not change them", async () => {
    const kitchen = await loginAs(app, "kitchen@test.com");
    expect((await kitchen.get("/categories")).status).toBe(200);
    expect((await kitchen.post("/categories").send({ name: "X" })).status).toBe(403);
  });
});
