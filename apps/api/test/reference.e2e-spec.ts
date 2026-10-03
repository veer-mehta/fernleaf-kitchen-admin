import { INestApplication } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp, loginAs, resetAndSeedAuth } from "./helpers/app";

describe("reference data (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetAndSeedAuth(prisma);
  });

  const kinds = ["allergens", "dietary-tags", "stations", "portion-sizes"];

  it.each(kinds)("admin can create, list, rename and delete %s", async (kind) => {
    const admin = await loginAs(app, "admin@test.com");
    const created = await admin.post(`/reference/${kind}`).send({ name: "Sample" });
    expect(created.status).toBe(201);

    const list = await admin.get(`/reference/${kind}`);
    expect(list.body.map((r: { name: string }) => r.name)).toContain("Sample");

    const renamed = await admin.patch(`/reference/${kind}/${created.body.id}`).send({ name: "Renamed" });
    expect(renamed.body.name).toBe("Renamed");

    expect((await admin.delete(`/reference/${kind}/${created.body.id}`)).status).toBe(200);
    expect((await admin.get(`/reference/${kind}`)).body).toHaveLength(0);
  });

  it("kitchen can read but not write; dispatch cannot even read", async () => {
    const kitchen = await loginAs(app, "kitchen@test.com");
    expect((await kitchen.get("/reference/allergens")).status).toBe(200);
    expect((await kitchen.post("/reference/allergens").send({ name: "Nuts" })).status).toBe(403);
    const dispatch = await loginAs(app, "dispatch@test.com");
    expect((await dispatch.get("/reference/allergens")).status).toBe(403);
  });

  it("rejects a duplicate name with a field error", async () => {
    const admin = await loginAs(app, "admin@test.com");
    await admin.post("/reference/allergens").send({ name: "Nuts" });
    const res = await admin.post("/reference/allergens").send({ name: " Nuts " });
    expect(res.status).toBe(409);
    expect(res.body.fields.name).toBeDefined();
  });

  it("rejects an empty name", async () => {
    const admin = await loginAs(app, "admin@test.com");
    const res = await admin.post("/reference/stations").send({ name: "   " });
    expect(res.status).toBe(400);
    expect(res.body.fields.name).toBeDefined();
  });

  it("cannot delete an allergen that a dish uses", async () => {
    const admin = await loginAs(app, "admin@test.com");
    const allergen = await prisma.allergen.create({ data: { name: "Gluten" } });
    const dish = await prisma.dish.create({
      data: { sku: "D1", name: "Bowl", temperature: "HOT", costCents: 100 },
    });
    await prisma.dishAllergen.create({ data: { dishId: dish.id, allergenId: allergen.id } });
    const res = await admin.delete(`/reference/allergens/${allergen.id}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("IN_USE");
  });

  it("cannot delete a station that a dish uses (and the dish keeps its station)", async () => {
    const admin = await loginAs(app, "admin@test.com");
    const station = await prisma.kitchenStation.create({ data: { name: "Grill" } });
    const dish = await prisma.dish.create({
      data: { sku: "D2", name: "Kebab", temperature: "HOT", costCents: 100, stationId: station.id },
    });
    expect((await admin.delete(`/reference/stations/${station.id}`)).status).toBe(409);
    expect((await prisma.dish.findUniqueOrThrow({ where: { id: dish.id } })).stationId).toBe(station.id);
  });

  it("unknown list or missing id gives 404", async () => {
    const admin = await loginAs(app, "admin@test.com");
    expect((await admin.get("/reference/colours")).status).toBe(404);
    expect((await admin.patch("/reference/allergens/999").send({ name: "X" })).status).toBe(404);
    expect((await admin.delete("/reference/allergens/999")).status).toBe(404);
  });
});
