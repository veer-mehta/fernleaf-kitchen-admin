import { INestApplication } from "@nestjs/common";
import { MenuService } from "../src/menu/menu.service";
import { CutoffProcessor } from "../src/orders/cutoff-processor.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp, FakeClock, loginAs, resetAndSeedAuth } from "./helpers/app";
import { AFTER_CUTOFF, BEFORE_CUTOFF, DELIVERY_DATE, orderWorld, type OrderWorld } from "./helpers/order-world";

describe("portion sizes (e2e)", () => {
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

  // A "Curry Bowl" (10.00) with a required "Protein" group: paneer (+2.00) and tofu (+1.50), sold in
  // Regular (no extra) and Large (+3.00).
  async function portionWorld(opts: { tofuSupportsLarge?: boolean; configureGroup?: boolean } = {}) {
    const w = await orderWorld(prisma);
    const admin = await loginAs(app, "admin@test.com");
    const regular = await prisma.portionSize.create({ data: { name: "Regular" } });
    const large = await prisma.portionSize.create({ data: { name: "Large" } });
    const paneer = (await admin.post("/options").send({ name: "Paneer", costCents: 100, portionSizeIds: [regular.id, large.id] })).body;
    const tofu = (await admin.post("/options").send({ name: "Tofu", costCents: 100, portionSizeIds: opts.tofuSupportsLarge === false ? [regular.id] : [regular.id, large.id] })).body;
    const curry = await w.f.dish("CURRY", { costCents: 500 });
    await w.f.categoryItem(w.category.id, curry.id);
    await w.f.dishPrice(w.standard.id, curry.id, 1000);
    await w.f.optionPrice(w.standard.id, paneer.id, 200);
    await w.f.optionPrice(w.standard.id, tofu.id, 150);
    const groupBody = {
      groups: [{ name: "Protein", required: true, usesPortions: true, optionIds: [paneer.id, tofu.id], portions: [{ portionSizeId: regular.id, extraCents: 0 }, { portionSizeId: large.id, extraCents: 300 }] }],
    };
    let saved = null;
    if (opts.configureGroup !== false) saved = await admin.put(`/dishes/${curry.id}/groups`).send(groupBody);
    return { w, admin, regular, large, paneer, tofu, curry, groupBody, saved };
  }
  const place = (admin: Agent, w: OrderWorld, curryId: number, combos: object[], quantity: number) =>
    admin.post("/orders").send({ employeeId: w.employee.id, deliveryDate: DELIVERY_DATE, lines: [{ dishId: curryId, quantity, combinations: combos }] });

  describe("options and groups", () => {
    it("an option records which sizes it can be served in", async () => {
      const { admin, regular, large } = await portionWorld();
      const list = await admin.get("/options?search=paneer");
      expect(list.body.items[0].portionSizes.map((s: { name: string }) => s.name).sort()).toEqual(["Large", "Regular"]);
      const tofu = list.body.items[0];
      const updated = await admin.patch(`/options/${tofu.id}`).send({ portionSizeIds: [regular.id] });
      expect(updated.body.portionSizes.map((s: { name: string }) => s.name)).toEqual(["Regular"]);
      void large;
    });

    it("unknown sizes are refused", async () => {
      const { admin } = await portionWorld();
      const res = await admin.post("/options").send({ name: "Odd", costCents: 100, portionSizeIds: [99999] });
      expect(res.status).toBe(400);
      expect(res.body.fields.portionSizeIds).toBeDefined();
    });

    it("saves a portioned group and returns its sizes, names and extra charges in order", async () => {
      const { saved, large } = await portionWorld();
      expect(saved!.status).toBe(200);
      const group = saved!.body.groups[0];
      expect(group.usesPortions).toBe(true);
      expect(group.portions).toEqual(expect.arrayContaining([
        { portionSizeId: large.id, name: "Large", extraCents: 300 },
      ]));
      expect(group.portions).toHaveLength(2);
    });

    it("every option in a portioned group must be sold in every one of the group's sizes", async () => {
      const { saved } = await portionWorld({ tofuSupportsLarge: false });
      expect(saved!.status).toBe(400);
      expect(saved!.body.fields["groups.0.optionIds"]).toMatch(/Tofu.*Large/);
    });

    it("a group that uses sizes needs at least one; a group that does not must not list any", async () => {
      const { admin, curry, paneer, regular } = await portionWorld({ configureGroup: false });
      const noSizes = await admin.put(`/dishes/${curry.id}/groups`).send({ groups: [{ name: "P", required: true, usesPortions: true, optionIds: [paneer.id], portions: [] }] });
      expect(noSizes.status).toBe(400);
      expect(noSizes.body.fields["groups.0.portions"]).toBeDefined();
      const stray = await admin.put(`/dishes/${curry.id}/groups`).send({ groups: [{ name: "P", required: true, usesPortions: false, optionIds: [paneer.id], portions: [{ portionSizeId: regular.id, extraCents: 0 }] }] });
      expect(stray.status).toBe(400);
      expect(stray.body.fields["groups.0.portions"]).toBeDefined();
    });

    it("rejects an unknown size, a repeated size and a negative or fractional extra charge", async () => {
      const { admin, curry, paneer, regular } = await portionWorld({ configureGroup: false });
      const body = (portions: object[]) => ({ groups: [{ name: "P", required: true, usesPortions: true, optionIds: [paneer.id], portions }] });
      expect((await admin.put(`/dishes/${curry.id}/groups`).send(body([{ portionSizeId: 99999, extraCents: 0 }]))).status).toBe(400);
      expect((await admin.put(`/dishes/${curry.id}/groups`).send(body([{ portionSizeId: regular.id, extraCents: 0 }, { portionSizeId: regular.id, extraCents: 5 }]))).status).toBe(400);
      expect((await admin.put(`/dishes/${curry.id}/groups`).send(body([{ portionSizeId: regular.id, extraCents: -1 }]))).status).toBe(400);
      expect((await admin.put(`/dishes/${curry.id}/groups`).send(body([{ portionSizeId: regular.id, extraCents: 2.5 }]))).status).toBe(400);
    });
  });

  describe("the menu", () => {
    it("shows the group's sizes with their extra charge", async () => {
      const { w, regular, large } = await portionWorld();
      const menu = await app.get(MenuService).forEmployee(w.employee.id);
      const dish = menu.categories.flatMap((c) => c.dishes).find((d) => d.sku === "CURRY")!;
      expect(dish.groups[0].usesPortions).toBe(true);
      expect(dish.groups[0].portions).toEqual([
        { portionSizeId: regular.id, name: "Regular", extraCents: 0 },
        { portionSizeId: large.id, name: "Large", extraCents: 300 },
      ]);
    });

    it("an option that stops supporting one of the sizes drops off the menu; the dish goes if it was the only one required", async () => {
      const { admin, w, regular, paneer, tofu } = await portionWorld();
      await admin.patch(`/options/${tofu.id}`).send({ portionSizeIds: [regular.id] }); // tofu no longer comes in Large
      let dish = (await app.get(MenuService).forEmployee(w.employee.id)).categories.flatMap((c) => c.dishes).find((d) => d.sku === "CURRY")!;
      expect(dish.groups[0].options.map((o) => o.name)).toEqual(["Paneer"]);
      await admin.patch(`/options/${paneer.id}`).send({ portionSizeIds: [] });
      dish = (await app.get(MenuService).forEmployee(w.employee.id)).categories.flatMap((c) => c.dishes).find((d) => d.sku === "CURRY")!;
      expect(dish).toBeUndefined(); // a required group with nothing left hides the dish
    });
  });

  describe("ordering", () => {
    it("prices option + size surcharge per unit, and snapshots the size", async () => {
      const { w, admin, curry, paneer, tofu, regular, large } = await portionWorld();
      const group = (await prisma.optionGroup.findFirstOrThrow({ where: { dishId: curry.id } })).id;
      const res = await place(admin, w, curry.id, [
        { quantity: 4, selections: [{ groupId: group, optionId: paneer.id, portionSizeId: large.id }] }, // 1000 + 200 + 300 = 1500
        { quantity: 2, selections: [{ groupId: group, optionId: tofu.id, portionSizeId: regular.id }] }, // 1000 + 150 + 0 = 1150
      ], 6);
      expect(res.status).toBe(201);
      const [big, small] = res.body.lines[0].combinations;
      expect([big.unitPriceCents, big.lineTotalCents]).toEqual([1500, 6000]);
      expect([small.unitPriceCents, small.lineTotalCents]).toEqual([1150, 2300]);
      expect(big.options).toEqual([{ groupName: "Protein", optionName: "Paneer", portion: "Large", priceCents: 500 }]); // 200 + 300
      expect(small.options[0]).toMatchObject({ optionName: "Tofu", portion: "Regular", priceCents: 150 });
      expect(res.body.totalCents).toBe(8300); // reconciles with the sum of the lines
    });

    it("the same option in two sizes is two combinations, not a duplicate", async () => {
      const { w, admin, curry, paneer, regular, large } = await portionWorld();
      const group = (await prisma.optionGroup.findFirstOrThrow({ where: { dishId: curry.id } })).id;
      const res = await place(admin, w, curry.id, [
        { quantity: 3, selections: [{ groupId: group, optionId: paneer.id, portionSizeId: regular.id }] },
        { quantity: 2, selections: [{ groupId: group, optionId: paneer.id, portionSizeId: large.id }] },
      ], 5);
      expect(res.status).toBe(201);
      expect(res.body.lines[0].combinations).toHaveLength(2);
    });

    it("a missing, unknown or foreign size is refused with a field error", async () => {
      const { w, admin, curry, paneer, regular } = await portionWorld();
      const group = (await prisma.optionGroup.findFirstOrThrow({ where: { dishId: curry.id } })).id;
      const none = await place(admin, w, curry.id, [{ quantity: 1, selections: [{ groupId: group, optionId: paneer.id }] }], 1);
      expect(none.status).toBe(400);
      expect(none.body.fields["lines.0.combinations.0.selections"]).toMatch(/size/i);
      const other = await prisma.portionSize.create({ data: { name: "Jumbo" } }); // exists, but this group does not sell it
      const wrong = await place(admin, w, curry.id, [{ quantity: 1, selections: [{ groupId: group, optionId: paneer.id, portionSizeId: other.id }] }], 1);
      expect(wrong.status).toBe(400);
      void regular;
    });

    it("a size on a group that is not sold in sizes is refused", async () => {
      const { w, admin, regular } = await portionWorld();
      const res = await admin.post("/orders").send({
        employeeId: w.employee.id, deliveryDate: DELIVERY_DATE,
        lines: [{ dishId: w.dish.id, quantity: 1, combinations: [{ quantity: 1, selections: [{ groupId: w.group.id, optionId: w.brown.id, portionSizeId: regular.id }] }] }],
      });
      expect(res.status).toBe(400);
    });

    it("an edited order and a placed draft keep the size and the price", async () => {
      const { w, admin, curry, paneer, large } = await portionWorld();
      const group = (await prisma.optionGroup.findFirstOrThrow({ where: { dishId: curry.id } })).id;
      const draft = await admin.post("/orders").send({
        employeeId: w.employee.id, deliveryDate: DELIVERY_DATE, status: "DRAFT",
        lines: [{ dishId: curry.id, quantity: 2, combinations: [{ quantity: 2, selections: [{ groupId: group, optionId: paneer.id, portionSizeId: large.id }] }] }],
      });
      expect(draft.status).toBe(201);
      const placed = await admin.post(`/orders/${draft.body.id}/place`);
      expect(placed.status).toBe(201);
      expect(placed.body.lines[0].combinations[0].options[0].portion).toBe("Large");
      expect(placed.body.totalCents).toBe(3000);
    });

    it("the kitchen board shows the size next to the choice", async () => {
      const { w, admin, curry, paneer, large } = await portionWorld();
      const group = (await prisma.optionGroup.findFirstOrThrow({ where: { dishId: curry.id } })).id;
      await place(admin, w, curry.id, [{ quantity: 2, selections: [{ groupId: group, optionId: paneer.id, portionSizeId: large.id }] }], 2).then((r) => expect(r.status).toBe(201));
      clock.set(AFTER_CUTOFF);
      await app.get(CutoffProcessor).processDate(DELIVERY_DATE);
      const board = await (await loginAs(app, "kitchen@test.com")).get(`/kitchen/board?date=${DELIVERY_DATE}`);
      expect(board.body.stations[0].units[0].optionsSummary).toBe("Paneer (Large)");
    });
  });
});
