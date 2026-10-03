import { INestApplication } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp, loginAs, resetAndSeedAuth } from "./helpers/app";

describe("dishes, options and groups (e2e)", () => {
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

  const dish = (over: Record<string, unknown> = {}) => ({
    sku: "BOWL-1",
    name: "Paneer Rice Bowl",
    temperature: "HOT",
    costCents: 8000,
    ...over,
  });

  describe("dishes", () => {
    it("creates a dish with allergens, a station and a minimum quantity", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const allergen = await prisma.allergen.create({ data: { name: "Dairy" } });
      const station = await prisma.kitchenStation.create({ data: { name: "Hot line" } });
      const res = await admin
        .post("/dishes")
        .send(dish({ allergenIds: [allergen.id], stationId: station.id, minOrderQty: 5 }));
      expect(res.status).toBe(201);
      expect(res.body.allergens).toEqual([{ id: allergen.id, name: "Dairy" }]);
      expect(res.body.station.name).toBe("Hot line");
      expect(res.body.minOrderQty).toBe(5);
      expect(res.body.active).toBe(true);
    });

    it("rejects a duplicate SKU with a field error", async () => {
      const admin = await loginAs(app, "admin@test.com");
      await admin.post("/dishes").send(dish());
      const res = await admin.post("/dishes").send(dish({ name: "Other" }));
      expect(res.status).toBe(409);
      expect(res.body.fields.sku).toBeDefined();
    });

    it("rejects fractional and negative costs (money is whole cents)", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const fractional = await admin.post("/dishes").send(dish({ costCents: 12.5 }));
      expect(fractional.status).toBe(400);
      expect(fractional.body.fields.costCents).toBeDefined();
      const negative = await admin.post("/dishes").send(dish({ costCents: -1 }));
      expect(negative.status).toBe(400);
    });

    it("rejects an unknown station or allergen", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const station = await admin.post("/dishes").send(dish({ stationId: 999 }));
      expect(station.status).toBe(400);
      expect(station.body.fields.stationId).toBeDefined();
      const allergen = await admin.post("/dishes").send(dish({ allergenIds: [999] }));
      expect(allergen.status).toBe(400);
      expect(allergen.body.fields.allergenIds).toBeDefined();
    });

    it("updates fields and replaces the allergen list without touching other fields", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const a1 = await prisma.allergen.create({ data: { name: "Nuts" } });
      const a2 = await prisma.allergen.create({ data: { name: "Soy" } });
      const created = await admin
        .post("/dishes")
        .send(dish({ description: "Tasty", allergenIds: [a1.id] }));
      const res = await admin.patch(`/dishes/${created.body.id}`).send({ name: "Renamed", allergenIds: [a2.id] });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Renamed");
      expect(res.body.description).toBe("Tasty"); // untouched
      expect(res.body.allergens.map((a: { name: string }) => a.name)).toEqual(["Soy"]);
    });

    it("cannot change a SKU to one that is taken", async () => {
      const admin = await loginAs(app, "admin@test.com");
      await admin.post("/dishes").send(dish());
      const second = await admin.post("/dishes").send(dish({ sku: "BOWL-2" }));
      const res = await admin.patch(`/dishes/${second.body.id}`).send({ sku: "BOWL-1" });
      expect(res.status).toBe(409);
      expect(res.body.fields.sku).toBeDefined();
    });

    it("deactivates and reactivates but never deletes", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const created = await admin.post("/dishes").send(dish());
      const off = await admin.post(`/dishes/${created.body.id}/deactivate`);
      expect(off.body.active).toBe(false);
      expect(await prisma.dish.count()).toBe(1);

      const inactive = await admin.get("/dishes?active=false");
      expect(inactive.body.total).toBe(1);
      expect((await admin.get("/dishes?active=true")).body.total).toBe(0);

      const on = await admin.post(`/dishes/${created.body.id}/activate`);
      expect(on.body.active).toBe(true);
      expect((await admin.delete(`/dishes/${created.body.id}`)).status).toBe(404); // no DELETE route
    });

    it("paginates and searches on the server", async () => {
      const admin = await loginAs(app, "admin@test.com");
      for (let i = 1; i <= 7; i++) {
        await admin.post("/dishes").send(dish({ sku: `S-${i}`, name: i === 4 ? "Paneer Tikka" : `Dish ${i}` }));
      }
      const page2 = await admin.get("/dishes?page=2&pageSize=3");
      expect(page2.body.items).toHaveLength(3);
      expect(page2.body.total).toBe(7);

      const search = await admin.get("/dishes?search=PANEER");
      expect(search.body.items.map((d: { name: string }) => d.name)).toEqual(["Paneer Tikka"]);
      const bySku = await admin.get("/dishes?search=s-6");
      expect(bySku.body.total).toBe(1);

      expect((await admin.get("/dishes?pageSize=1000")).status).toBe(400);
    });

    it("filters by station", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const grill = await prisma.kitchenStation.create({ data: { name: "Grill" } });
      await admin.post("/dishes").send(dish({ sku: "G1", stationId: grill.id }));
      await admin.post("/dishes").send(dish({ sku: "N1" }));
      const res = await admin.get(`/dishes?stationId=${grill.id}`);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0].sku).toBe("G1");
    });

    it("kitchen can read dishes but not write; dispatch cannot read", async () => {
      const kitchen = await loginAs(app, "kitchen@test.com");
      expect((await kitchen.get("/dishes")).status).toBe(200);
      expect((await kitchen.post("/dishes").send(dish())).status).toBe(403);
      const dispatch = await loginAs(app, "dispatch@test.com");
      expect((await dispatch.get("/dishes")).status).toBe(403);
    });

    it("returns 404 for a missing dish", async () => {
      const admin = await loginAs(app, "admin@test.com");
      expect((await admin.get("/dishes/999")).status).toBe(404);
    });
  });

  describe("options", () => {
    it("creates, lists, searches and deactivates an option", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const nuts = await prisma.allergen.create({ data: { name: "Nuts" } });
      const created = await admin
        .post("/options")
        .send({ name: "Paneer", costCents: 1500, allergenIds: [nuts.id] });
      expect(created.status).toBe(201);
      expect(created.body.allergens[0].name).toBe("Nuts");

      const search = await admin.get("/options?search=pan");
      expect(search.body.total).toBe(1);

      const off = await admin.patch(`/options/${created.body.id}`).send({ active: false });
      expect(off.body.active).toBe(false);
    });

    it("rejects fractional option cost", async () => {
      const admin = await loginAs(app, "admin@test.com");
      const res = await admin.post("/options").send({ name: "Tofu", costCents: 10.5 });
      expect(res.status).toBe(400);
      expect(res.body.fields.costCents).toBeDefined();
    });
  });

  describe("option groups", () => {
    async function setup() {
      const admin = await loginAs(app, "admin@test.com");
      const d = await admin.post("/dishes").send(dish());
      const paneer = await prisma.option.create({ data: { name: "Paneer", costCents: 100 } });
      const tofu = await prisma.option.create({ data: { name: "Tofu", costCents: 50 } });
      const raita = await prisma.option.create({ data: { name: "Raita", costCents: 30 } });
      return { admin, dishId: d.body.id as number, paneer, tofu, raita };
    }

    it("stores groups with their options in the order given", async () => {
      const { admin, dishId, paneer, tofu, raita } = await setup();
      const res = await admin.put(`/dishes/${dishId}/groups`).send({
        groups: [
          { name: "Protein", required: true, optionIds: [tofu.id, paneer.id] },
          { name: "Side", required: false, optionIds: [raita.id] },
        ],
      });
      expect(res.status).toBe(200);
      const groups = res.body.groups;
      expect(groups.map((g: { name: string }) => g.name)).toEqual(["Protein", "Side"]);
      expect(groups[0].required).toBe(true);
      expect(groups[0].options.map((o: { name: string }) => o.name)).toEqual(["Tofu", "Paneer"]);
      expect(groups[1].required).toBe(false);
    });

    it("replaces the previous groups on every save", async () => {
      const { admin, dishId, paneer, raita } = await setup();
      await admin.put(`/dishes/${dishId}/groups`).send({
        groups: [
          { name: "A", required: true, optionIds: [paneer.id] },
          { name: "B", required: false, optionIds: [raita.id] },
        ],
      });
      const res = await admin
        .put(`/dishes/${dishId}/groups`)
        .send({ groups: [{ name: "Only", required: false, optionIds: [raita.id] }] });
      expect(res.body.groups).toHaveLength(1);
      expect(await prisma.optionGroup.count()).toBe(1);
    });

    it("an empty list removes all groups", async () => {
      const { admin, dishId, paneer } = await setup();
      await admin.put(`/dishes/${dishId}/groups`).send({ groups: [{ name: "A", required: true, optionIds: [paneer.id] }] });
      const res = await admin.put(`/dishes/${dishId}/groups`).send({ groups: [] });
      expect(res.body.groups).toEqual([]);
    });

    it("rejects an unknown option, a duplicate option and an empty group", async () => {
      const { admin, dishId, paneer } = await setup();
      const unknown = await admin
        .put(`/dishes/${dishId}/groups`)
        .send({ groups: [{ name: "A", required: true, optionIds: [999] }] });
      expect(unknown.status).toBe(400);
      expect(unknown.body.fields["groups.0.optionIds"]).toBeDefined();

      const dup = await admin
        .put(`/dishes/${dishId}/groups`)
        .send({ groups: [{ name: "A", required: true, optionIds: [paneer.id, paneer.id] }] });
      expect(dup.status).toBe(400);

      const empty = await admin
        .put(`/dishes/${dishId}/groups`)
        .send({ groups: [{ name: "A", required: true, optionIds: [] }] });
      expect(empty.status).toBe(400);
    });

    it("a failed save leaves the old groups in place", async () => {
      const { admin, dishId, paneer } = await setup();
      await admin.put(`/dishes/${dishId}/groups`).send({ groups: [{ name: "Keep", required: true, optionIds: [paneer.id] }] });
      await admin.put(`/dishes/${dishId}/groups`).send({ groups: [{ name: "Bad", required: true, optionIds: [999] }] });
      const detail = await admin.get(`/dishes/${dishId}`);
      expect(detail.body.groups.map((g: { name: string }) => g.name)).toEqual(["Keep"]);
    });
  });
});
