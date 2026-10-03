import { INestApplication } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp, loginAs, resetAndSeedAuth } from "./helpers/app";

describe("price tiers (e2e)", () => {
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

  const mkDish = (sku: string, costCents: number, over: Record<string, unknown> = {}) =>
    prisma.dish.create({ data: { sku, name: `Dish ${sku}`, temperature: "HOT", costCents, ...over } });
  const mkOption = (name: string, costCents: number) => prisma.option.create({ data: { name, costCents } });

  // grid helpers
  const dishPrice = async (admin: Awaited<ReturnType<typeof loginAs>>, tierId: number, dishId: number) => {
    const grid = await admin.get(`/tiers/${tierId}/grid`);
    return grid.body.dishes.find((d: { dishId: number }) => d.dishId === dishId);
  };

  describe("tiers", () => {
    it("the first tier becomes the default automatically", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const first = await admin.post("/tiers").send({ name: "Standard" });
      expect(first.status).toBe(201);
      expect(first.body.isDefault).toBe(true);
      const second = await admin.post("/tiers").send({ name: "Enterprise" });
      expect(second.body.isDefault).toBe(false);
    });

    it("making another tier the default flips the old one (exactly one default)", async () => {
      const admin = await loginAs(app, "admin@test.com");
      await admin.post("/tiers").send({ name: "Standard" });
      await admin.post("/tiers").send({ name: "Partner", isDefault: true });
      const list = await admin.get("/tiers");
      expect(list.body.filter((t: { isDefault: boolean }) => t.isDefault)).toHaveLength(1);
      expect(list.body.find((t: { isDefault: boolean }) => t.isDefault).name).toBe("Partner");
    });

    it("the database itself refuses a second default", async () => {
      await prisma.priceTier.create({ data: { name: "A", isDefault: true } });
      await expect(prisma.priceTier.create({ data: { name: "B", isDefault: true } })).rejects.toThrow();
    });

    it("cannot switch the default off without choosing another", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const standard = await admin.post("/tiers").send({ name: "Standard" });
      const res = await admin.patch(`/tiers/${standard.body.id}`).send({ isDefault: false });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("DEFAULT_REQUIRED");
    });

    it("rejects a duplicate tier name", async () => {
      const admin = await loginAs(app, "admin@test.com");
      await admin.post("/tiers").send({ name: "Standard" });
      const res = await admin.post("/tiers").send({ name: "Standard" });
      expect(res.status).toBe(409);
      expect(res.body.fields.name).toBeDefined();
    });

    it("rejects a rule with a missing base tier", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const res = await admin
        .post("/tiers")
        .send({ name: "X", derivation: { type: "TIER_PERCENT", percentBp: 1000, baseTierId: 999 } });
      expect(res.status).toBe(400);
      expect(res.body.fields["derivation.baseTierId"]).toBeDefined();
    });

    it("rejects a cycle: A based on B while B is based on A", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const a = await admin.post("/tiers").send({ name: "A" });
      const b = await admin
        .post("/tiers")
        .send({ name: "B", derivation: { type: "TIER_PERCENT", percentBp: 1000, baseTierId: a.body.id } });
      const res = await admin
        .patch(`/tiers/${a.body.id}`)
        .send({ derivation: { type: "TIER_PERCENT", percentBp: 500, baseTierId: b.body.id } });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("TIER_CYCLE");
    });

    it("a tier cannot be based on itself", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const a = await admin.post("/tiers").send({ name: "A" });
      const res = await admin
        .patch(`/tiers/${a.body.id}`)
        .send({ derivation: { type: "TIER_PERCENT", percentBp: 500, baseTierId: a.body.id } });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("TIER_CYCLE");
    });
  });

  describe("derivation", () => {
    it("cost x 2.4 fills the grid for dishes and options, rounded up to 5c", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const dish = await mkDish("D1", 88); // 211.2 -> 215
      const option = await mkOption("Paneer", 100); // 240 -> 240
      const tier = await admin
        .post("/tiers")
        .send({ name: "Enterprise", derivation: { type: "COST_MULTIPLE", multiplierMilli: 2400 } });
      const grid = await admin.get(`/tiers/${tier.body.id}/grid`);
      expect(grid.body.dishes.find((d: { dishId: number }) => d.dishId === dish.id).priceCents).toBe(215);
      expect(grid.body.options.find((o: { optionId: number }) => o.optionId === option.id).priceCents).toBe(240);
      expect(grid.body.dishes[0].isOverride).toBe(false);
    });

    it("a tier based on another adds a percentage to its prices", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const dish = await mkDish("D1", 100);
      const standard = await admin.post("/tiers").send({ name: "Standard" });
      await admin.put(`/tiers/${standard.body.id}/dish-prices/${dish.id}`).send({ cents: 1000 });
      const partner = await admin.post("/tiers").send({
        name: "Partner",
        derivation: { type: "TIER_PERCENT", percentBp: 1500, baseTierId: standard.body.id },
      });
      expect((await dishPrice(admin, partner.body.id, dish.id)).priceCents).toBe(1150);
    });

    it("a dish with no price on the base tier gets no price on the derived tier", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const dish = await mkDish("D1", 100);
      const standard = await admin.post("/tiers").send({ name: "Standard" });
      const partner = await admin.post("/tiers").send({
        name: "Partner",
        derivation: { type: "TIER_PERCENT", percentBp: 1500, baseTierId: standard.body.id },
      });
      expect((await dishPrice(admin, partner.body.id, dish.id)).priceCents).toBeNull();
    });

    it("changing the base tier's price updates the derived tier", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const dish = await mkDish("D1", 100);
      const standard = await admin.post("/tiers").send({ name: "Standard" });
      const partner = await admin.post("/tiers").send({
        name: "Partner",
        derivation: { type: "TIER_PERCENT", percentBp: 1000, baseTierId: standard.body.id },
      });
      await admin.put(`/tiers/${standard.body.id}/dish-prices/${dish.id}`).send({ cents: 1000 });
      expect((await dishPrice(admin, partner.body.id, dish.id)).priceCents).toBe(1100);
      await admin.put(`/tiers/${standard.body.id}/dish-prices/${dish.id}`).send({ cents: 2000 });
      expect((await dishPrice(admin, partner.body.id, dish.id)).priceCents).toBe(2200);
    });

    it("changes ripple through a chain of tiers", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const dish = await mkDish("D1", 100);
      const a = await admin.post("/tiers").send({ name: "A" });
      const b = await admin.post("/tiers").send({
        name: "B",
        derivation: { type: "TIER_PERCENT", percentBp: 1000, baseTierId: a.body.id },
      });
      const c = await admin.post("/tiers").send({
        name: "C",
        derivation: { type: "TIER_PERCENT", percentBp: 1000, baseTierId: b.body.id },
      });
      await admin.put(`/tiers/${a.body.id}/dish-prices/${dish.id}`).send({ cents: 1000 });
      expect((await dishPrice(admin, c.body.id, dish.id)).priceCents).toBe(1210);
    });

    it("a manual override survives a cost change; the other prices follow", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const d1 = await mkDish("D1", 100);
      const d2 = await mkDish("D2", 100);
      const tier = await admin
        .post("/tiers")
        .send({ name: "Enterprise", derivation: { type: "COST_MULTIPLE", multiplierMilli: 2000 } });
      await admin.put(`/tiers/${tier.body.id}/dish-prices/${d1.id}`).send({ cents: 999 });
      await admin.patch(`/dishes/${d1.id}`).send({ costCents: 200 });
      await admin.patch(`/dishes/${d2.id}`).send({ costCents: 200 });
      const p1 = await dishPrice(admin, tier.body.id, d1.id);
      const p2 = await dishPrice(admin, tier.body.id, d2.id);
      expect(p1.priceCents).toBe(999);
      expect(p1.isOverride).toBe(true);
      expect(p2.priceCents).toBe(400);
    });

    it("clearing an override restores the derived price", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const dish = await mkDish("D1", 100);
      const tier = await admin
        .post("/tiers")
        .send({ name: "Enterprise", derivation: { type: "COST_MULTIPLE", multiplierMilli: 2000 } });
      await admin.put(`/tiers/${tier.body.id}/dish-prices/${dish.id}`).send({ cents: 999 });
      await admin.delete(`/tiers/${tier.body.id}/dish-prices/${dish.id}`);
      const p = await dishPrice(admin, tier.body.id, dish.id);
      expect(p.priceCents).toBe(200);
      expect(p.isOverride).toBe(false);
    });

    it("changing the rule recomputes derived prices but keeps overrides", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const d1 = await mkDish("D1", 100);
      const d2 = await mkDish("D2", 100);
      const tier = await admin
        .post("/tiers")
        .send({ name: "Enterprise", derivation: { type: "COST_MULTIPLE", multiplierMilli: 2000 } });
      await admin.put(`/tiers/${tier.body.id}/dish-prices/${d1.id}`).send({ cents: 555 });
      await admin
        .patch(`/tiers/${tier.body.id}`)
        .send({ derivation: { type: "COST_MULTIPLE", multiplierMilli: 3000 } });
      expect((await dishPrice(admin, tier.body.id, d1.id)).priceCents).toBe(555);
      expect((await dishPrice(admin, tier.body.id, d2.id)).priceCents).toBe(300);
    });

    it("a dish created after the tier gets its derived price automatically", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const tier = await admin
        .post("/tiers")
        .send({ name: "Enterprise", derivation: { type: "COST_MULTIPLE", multiplierMilli: 2000 } });
      const created = await admin.post("/dishes").send({ sku: "NEW", name: "New", temperature: "HOT", costCents: 150 });
      expect((await dishPrice(admin, tier.body.id, created.body.id)).priceCents).toBe(300);
    });

    it("an option cost change also reprices the option", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const option = await mkOption("Paneer", 100);
      const tier = await admin
        .post("/tiers")
        .send({ name: "Enterprise", derivation: { type: "COST_MULTIPLE", multiplierMilli: 2000 } });
      await admin.patch(`/options/${option.id}`).send({ costCents: 150 });
      const grid = await admin.get(`/tiers/${tier.body.id}/grid`);
      expect(grid.body.options[0].priceCents).toBe(300);
    });
  });

  describe("manual prices and the missing-price report", () => {
    it("setting a price validates cents, dish and tier", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const dish = await mkDish("D1", 100);
      const tier = await admin.post("/tiers").send({ name: "Standard" });
      const base = `/tiers/${tier.body.id}/dish-prices`;
      expect((await admin.put(`${base}/${dish.id}`).send({ cents: 0 })).status).toBe(400); // dish at 0 would look free
      expect((await admin.put(`${base}/${dish.id}`).send({ cents: 12.5 })).status).toBe(400);
      expect((await admin.put(`${base}/999`).send({ cents: 100 })).status).toBe(404);
      expect((await admin.put(`/tiers/999/dish-prices/${dish.id}`).send({ cents: 100 })).status).toBe(404);
    });

    it("an option can be priced at 0 cents", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const option = await mkOption("Brown rice", 0);
      const tier = await admin.post("/tiers").send({ name: "Standard" });
      const res = await admin.put(`/tiers/${tier.body.id}/option-prices/${option.id}`).send({ cents: 0 });
      expect(res.status).toBe(200);
    });

    it("reports active dishes and options with no price, and updates as prices are set", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const priced = await mkDish("D1", 100);
      const unpriced = await mkDish("D2", 100);
      await mkDish("OFF", 100, { active: false });
      await mkOption("Paneer", 100);
      const tier = await admin.post("/tiers").send({ name: "Standard" });
      await admin.put(`/tiers/${tier.body.id}/dish-prices/${priced.id}`).send({ cents: 500 });

      const missing = await admin.get(`/tiers/${tier.body.id}/missing`);
      expect(missing.body.dishes.map((d: { dishId: number }) => d.dishId)).toEqual([unpriced.id]);
      expect(missing.body.options).toHaveLength(1);

      await admin.put(`/tiers/${tier.body.id}/dish-prices/${unpriced.id}`).send({ cents: 500 });
      expect((await admin.get(`/tiers/${tier.body.id}/missing`)).body.dishes).toEqual([]);
    });
  });

  it("only admin can see or change pricing", async () => {
    const kitchen = await loginAs(app, "kitchen@test.com");
    expect((await kitchen.get("/tiers")).status).toBe(403);
    expect((await kitchen.post("/tiers").send({ name: "X" })).status).toBe(403);
    const admin = await loginAs(app, "admin@test.com");
    expect((await admin.get("/tiers")).status).toBe(200);
  });
});
