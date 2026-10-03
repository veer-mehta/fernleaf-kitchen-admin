import { INestApplication } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp, loginAs, resetAndSeedAuth } from "./helpers/app";

// Each of the four accounts may reach only its own role's endpoints.
// Later phases add rows to this table as new endpoints appear (e.g. POST /orders).
describe("account isolation (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await resetAndSeedAuth(prisma);
  });
  afterAll(async () => {
    await app.close();
  });

  // [method, path, who may call it]
  const rules: ["get" | "post", string, string[]][] = [
    ["get", "/staff", ["admin@test.com"]],
    ["get", "/roles", ["admin@test.com"]],
    ["get", "/tiers", ["admin@test.com"]],
    ["get", "/orders", ["admin@test.com", "kitchen@test.com", "dispatch@test.com"]],
    ["get", "/companies", ["admin@test.com", "dispatch@test.com"]],
    ["get", "/employees", ["admin@test.com"]],
    ["get", "/drivers", ["admin@test.com", "dispatch@test.com"]],
    ["get", "/settings", ["admin@test.com"]],
    ["get", "/kitchen-holidays", ["admin@test.com"]],
    ["get", "/dishes", ["admin@test.com", "kitchen@test.com"]],
    ["get", "/options", ["admin@test.com", "kitchen@test.com"]],
    ["get", "/categories", ["admin@test.com", "kitchen@test.com"]],
    ["get", "/reference/allergens", ["admin@test.com", "kitchen@test.com"]],
  ];
  const accounts = ["admin@test.com", "kitchen@test.com", "dispatch@test.com", "driver@test.com"];

  describe.each(rules)("%s %s", (method, path, allowed) => {
    it.each(accounts)("%s", async (email) => {
      const agent = await loginAs(app, email);
      const res = await agent[method](path);
      if (allowed.includes(email)) {
        expect(res.status).toBeLessThan(300);
      } else {
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("FORBIDDEN");
      }
    });
  });

  it("each account sees a different permission list", async () => {
    const lists = new Set<string>();
    for (const email of accounts) {
      const me = await (await loginAs(app, email)).get("/auth/me");
      lists.add(JSON.stringify([...me.body.permissions].sort()));
    }
    expect(lists.size).toBe(4);
  });

  it("only the driver has driver permissions", async () => {
    const driver = await (await loginAs(app, "driver@test.com")).get("/auth/me");
    const admin = await (await loginAs(app, "admin@test.com")).get("/auth/me");
    expect(driver.body.permissions).toEqual(["dashboard:read", "driver:own-drops"]);
    expect(admin.body.permissions).toContain("driver:own-drops");
  });

  it("/health stays public", async () => {
    const { default: request } = await import("supertest");
    expect((await request(app.getHttpServer()).get("/health")).status).toBe(200);
  });
});
