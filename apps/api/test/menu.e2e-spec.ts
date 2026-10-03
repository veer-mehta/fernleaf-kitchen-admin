import { INestApplication } from "@nestjs/common";
import { MenuService } from "../src/menu/menu.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp, loginAs, resetAndSeedAuth } from "./helpers/app";
import { fixtures } from "./helpers/fixtures";

describe("menu resolution (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let menu: MenuService;
  let f: ReturnType<typeof fixtures>;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    menu = app.get(MenuService);
    f = fixtures(prisma);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetAndSeedAuth(prisma);
  });

  // A default tier "Standard" and a company on it, one employee, one category.
  async function world() {
    const standard = await f.tier("Standard", true);
    const company = await f.company();
    const employee = await f.employee(company.id);
    const category = await f.category("Bowls");
    return { standard, company, employee, category };
  }
  const dishNames = (m: Awaited<ReturnType<MenuService["forEmployee"]>>) =>
    m.categories.flatMap((c) => c.dishes.map((d) => d.sku));

  describe("which tier and price", () => {
    it("uses the company's own tier price", async () => {
      const { standard, company, employee, category } = await world();
      const enterprise = await f.tier("Enterprise");
      await prisma.company.update({ where: { id: company.id }, data: { priceTierId: enterprise.id } });
      const dish = await f.dish("D1");
      await f.categoryItem(category.id, dish.id);
      await f.dishPrice(standard.id, dish.id, 300);
      await f.dishPrice(enterprise.id, dish.id, 500);

      const m = await menu.forEmployee(employee.id);
      expect(m.tierId).toBe(enterprise.id);
      expect(m.categories[0].dishes[0].priceCents).toBe(500);
    });

    it("falls back to the default tier when the company has none", async () => {
      const { standard, employee, category } = await world();
      const dish = await f.dish("D1");
      await f.categoryItem(category.id, dish.id);
      await f.dishPrice(standard.id, dish.id, 300);

      const m = await menu.forEmployee(employee.id);
      expect(m.tierId).toBe(standard.id);
      expect(m.categories[0].dishes[0].priceCents).toBe(300);
    });

    it("a dish with no price on the employee's tier is not on the menu at all", async () => {
      const { standard, employee, category } = await world();
      const priced = await f.dish("PRICED");
      const unpriced = await f.dish("UNPRICED");
      await f.categoryItem(category.id, priced.id);
      await f.categoryItem(category.id, unpriced.id);
      await f.dishPrice(standard.id, priced.id, 300);

      expect(dishNames(await menu.forEmployee(employee.id))).toEqual(["PRICED"]);
    });

    it("RF6: nothing priced on the default tier gives an empty menu, not an error", async () => {
      const { employee, category } = await world();
      await f.categoryItem(category.id, (await f.dish("D1")).id);
      const m = await menu.forEmployee(employee.id);
      expect(m.categories).toEqual([]);
      expect(m.secretDishes).toEqual([]);
    });

    it("RF6: no tiers at all gives an empty menu with no tier", async () => {
      const company = await f.company();
      const employee = await f.employee(company.id);
      const m = await menu.forEmployee(employee.id);
      expect(m.tierId).toBeNull();
      expect(m.categories).toEqual([]);
    });
  });

  describe("what is switched off or hidden", () => {
    it("drops inactive dishes, categories and category items", async () => {
      const { standard, employee, category } = await world();
      const off = await f.dish("OFF", { active: false });
      const hiddenItem = await f.dish("ITEM-OFF");
      const ok = await f.dish("OK");
      const offCategory = await f.category("Old", { active: false });
      const inOffCategory = await f.dish("IN-OFF-CAT");
      for (const d of [off, hiddenItem, ok, inOffCategory]) await f.dishPrice(standard.id, d.id, 100);
      await f.categoryItem(category.id, off.id);
      await f.categoryItem(category.id, hiddenItem.id, { active: false });
      await f.categoryItem(category.id, ok.id);
      await f.categoryItem(offCategory.id, inOffCategory.id);

      expect(dishNames(await menu.forEmployee(employee.id))).toEqual(["OK"]);
    });

    it("a category hidden for the company hides its items for that company only", async () => {
      const { standard, company, employee, category } = await world();
      const dish = await f.dish("D1");
      await f.categoryItem(category.id, dish.id);
      await f.dishPrice(standard.id, dish.id, 100);
      const other = await f.employee((await f.company()).id);
      await f.hideCategory(company.id, category.id);

      expect((await menu.forEmployee(employee.id)).categories).toEqual([]);
      expect(dishNames(await menu.forEmployee(other.id))).toEqual(["D1"]);
    });

    it("a dish hidden for the company disappears from every category, others stay", async () => {
      const { standard, company, employee, category } = await world();
      const second = await f.category("More");
      const hidden = await f.dish("HIDDEN");
      const shown = await f.dish("SHOWN");
      for (const d of [hidden, shown]) await f.dishPrice(standard.id, d.id, 100);
      await f.categoryItem(category.id, hidden.id);
      await f.categoryItem(category.id, shown.id);
      await f.categoryItem(second.id, hidden.id);
      await f.hideDish(company.id, hidden.id);

      expect(dishNames(await menu.forEmployee(employee.id))).toEqual(["SHOWN"]);
    });

    it("a dish in a hidden category stays visible if it is also in a visible one", async () => {
      const { standard, company, employee, category } = await world();
      const second = await f.category("Visible");
      const dish = await f.dish("D1");
      await f.dishPrice(standard.id, dish.id, 100);
      await f.categoryItem(category.id, dish.id);
      await f.categoryItem(second.id, dish.id);
      await f.hideCategory(company.id, category.id);

      const m = await menu.forEmployee(employee.id);
      expect(m.categories.map((c) => c.name)).toEqual(["Visible"]);
    });

    it("categories left with no dishes are not listed", async () => {
      const { employee } = await world();
      expect((await menu.forEmployee(employee.id)).categories).toEqual([]);
    });
  });

  describe("options and groups", () => {
    async function dishWithRequiredGroup() {
      const w = await world();
      const dish = await f.dish("BOWL");
      await f.categoryItem(w.category.id, dish.id);
      await f.dishPrice(w.standard.id, dish.id, 1000);
      const paneer = await f.option("Paneer");
      const tofu = await f.option("Tofu");
      return { ...w, dish, paneer, tofu };
    }

    it("shows options priced on the tier, in group order, with their prices", async () => {
      const { standard, employee, dish, paneer, tofu } = await dishWithRequiredGroup();
      await f.group(dish.id, "Protein", true, [tofu.id, paneer.id]);
      await f.optionPrice(standard.id, paneer.id, 150);
      await f.optionPrice(standard.id, tofu.id, 100);

      const d = (await menu.forEmployee(employee.id)).categories[0].dishes[0];
      expect(d.groups[0].required).toBe(true);
      expect(d.groups[0].options.map((o) => [o.name, o.priceCents])).toEqual([
        ["Tofu", 100],
        ["Paneer", 150],
      ]);
    });

    it("drops an option with no price on the tier but keeps the dish if others remain", async () => {
      const { standard, employee, dish, paneer, tofu } = await dishWithRequiredGroup();
      await f.group(dish.id, "Protein", true, [paneer.id, tofu.id]);
      await f.optionPrice(standard.id, paneer.id, 150); // tofu unpriced

      const d = (await menu.forEmployee(employee.id)).categories[0].dishes[0];
      expect(d.groups[0].options.map((o) => o.name)).toEqual(["Paneer"]);
    });

    it("hides the whole dish when a REQUIRED group has no available option", async () => {
      const { employee, dish, paneer } = await dishWithRequiredGroup();
      await f.group(dish.id, "Protein", true, [paneer.id]); // paneer has no price
      expect((await menu.forEmployee(employee.id)).categories).toEqual([]);
    });

    it("hides the dish when the only option of a required group is inactive", async () => {
      const { standard, employee, dish } = await dishWithRequiredGroup();
      const old = await f.option("Old", { active: false });
      await f.optionPrice(standard.id, old.id, 100);
      await f.group(dish.id, "Protein", true, [old.id]);
      expect((await menu.forEmployee(employee.id)).categories).toEqual([]);
    });

    it("keeps the dish but drops an OPTIONAL group with no available option", async () => {
      const { employee, dish, paneer } = await dishWithRequiredGroup();
      await f.group(dish.id, "Extras", false, [paneer.id]); // unpriced
      const d = (await menu.forEmployee(employee.id)).categories[0].dishes[0];
      expect(d.groups).toEqual([]);
    });

    it("orders groups by display order", async () => {
      const { standard, employee, dish, paneer } = await dishWithRequiredGroup();
      await f.optionPrice(standard.id, paneer.id, 10);
      await f.group(dish.id, "Second", false, [paneer.id], 2);
      await f.group(dish.id, "First", false, [paneer.id], 1);
      const d = (await menu.forEmployee(employee.id)).categories[0].dishes[0];
      expect(d.groups.map((g) => g.name)).toEqual(["First", "Second"]);
    });
  });

  describe("ordering and secret categories", () => {
    it("lists categories and dishes by their display order", async () => {
      const { standard, employee } = await world();
      const b = await f.category("B", { displayOrder: 2 });
      const a = await f.category("A", { displayOrder: 1 });
      const d1 = await f.dish("D1");
      const d2 = await f.dish("D2");
      for (const d of [d1, d2]) await f.dishPrice(standard.id, d.id, 100);
      await f.categoryItem(a.id, d1.id, { displayOrder: 2 });
      await f.categoryItem(a.id, d2.id, { displayOrder: 1 });
      await f.categoryItem(b.id, d1.id);

      const m = await menu.forEmployee(employee.id);
      expect(m.categories.map((c) => c.name)).toEqual(["A", "B"]);
      expect(m.categories[0].dishes.map((d) => d.sku)).toEqual(["D2", "D1"]);
    });

    it("a secret category is not listed, but its dishes can still be found by id", async () => {
      const { standard, employee } = await world();
      const secret = await f.category("Chef specials", { isSecret: true });
      const dish = await f.dish("SECRET");
      await f.dishPrice(standard.id, dish.id, 900);
      await f.categoryItem(secret.id, dish.id);

      const m = await menu.forEmployee(employee.id);
      expect(m.categories).toEqual([]);
      expect(m.secretDishes.map((d) => d.sku)).toEqual(["SECRET"]);
      expect((await menu.findDishForEmployee(employee.id, dish.id))?.priceCents).toBe(900);
    });

    it("findDishForEmployee refuses dishes the employee could not see", async () => {
      const { standard, company, employee, category } = await world();
      const unpriced = await f.dish("UNPRICED");
      const hidden = await f.dish("HIDDEN");
      const orphan = await f.dish("ORPHAN"); // in no category
      await f.dishPrice(standard.id, hidden.id, 100);
      await f.dishPrice(standard.id, orphan.id, 100);
      await f.categoryItem(category.id, unpriced.id);
      await f.categoryItem(category.id, hidden.id);
      await f.hideDish(company.id, hidden.id);

      expect(await menu.findDishForEmployee(employee.id, unpriced.id)).toBeNull();
      expect(await menu.findDishForEmployee(employee.id, hidden.id)).toBeNull();
      expect(await menu.findDishForEmployee(employee.id, orphan.id)).toBeNull();
      expect(await menu.findDishForEmployee(employee.id, 99999)).toBeNull();
    });

    it("carries minimum order quantity, allergens and dietary tags for the order builder", async () => {
      const { standard, employee, category } = await world();
      const dish = await f.dish("D1", { minOrderQty: 5 });
      const nuts = await prisma.allergen.create({ data: { name: "Nuts" } });
      const vegan = await prisma.dietaryTag.create({ data: { name: "Vegan" } });
      await prisma.dishAllergen.create({ data: { dishId: dish.id, allergenId: nuts.id } });
      await prisma.dishDietaryTag.create({ data: { dishId: dish.id, dietaryTagId: vegan.id } });
      await f.categoryItem(category.id, dish.id);
      await f.dishPrice(standard.id, dish.id, 100);

      const d = (await menu.forEmployee(employee.id)).categories[0].dishes[0];
      expect(d.minOrderQty).toBe(5);
      expect(d.allergens).toEqual(["Nuts"]);
      expect(d.dietaryTags).toEqual(["Vegan"]);
    });
  });

  describe("the preview endpoint", () => {
    it("is the same function: kitchen and admin can preview, driver cannot, unknown employee is 404", async () => {
      const { standard, employee, category } = await world();
      const dish = await f.dish("D1");
      await f.categoryItem(category.id, dish.id);
      await f.dishPrice(standard.id, dish.id, 100);

      const admin = await loginAs(app, "admin@test.com");
      const res = await admin.get(`/employees/${employee.id}/menu`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(JSON.parse(JSON.stringify(await menu.forEmployee(employee.id))));

      expect((await (await loginAs(app, "kitchen@test.com")).get(`/employees/${employee.id}/menu`)).status).toBe(200);
      expect((await (await loginAs(app, "driver@test.com")).get(`/employees/${employee.id}/menu`)).status).toBe(403);
      expect((await admin.get("/employees/9999/menu")).status).toBe(404);
    });
  });
});
