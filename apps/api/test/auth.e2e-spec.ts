import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp, loginAs, resetAndSeedAuth } from "./helpers/app";

describe("auth (e2e)", () => {
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

  it("login sets an httpOnly cookie and /auth/me returns the role's permissions", async () => {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "kitchen@test.com", password: "Test@1234" });
    expect(res.status).toBe(200);
    const cookie = (res.headers["set-cookie"] as unknown as string[]).join(";");
    expect(cookie).toContain("token=");
    expect(cookie.toLowerCase()).toContain("httponly");

    const agent = await loginAs(app, "kitchen@test.com");
    const me = await agent.get("/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.email).toBe("kitchen@test.com");
    expect(me.body.role).toBe("Kitchen");
    expect(me.body.permissions).toContain("kitchen:update");
    expect(me.body.permissions).not.toContain("orders:write");
    expect(me.body.passwordHash).toBeUndefined();
  });

  it("login is case-insensitive on email", async () => {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "Admin@Test.com", password: "Test@1234" });
    expect(res.status).toBe(200);
  });

  it("wrong password and unknown email give the same 401", async () => {
    const wrong = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "admin@test.com", password: "nope" });
    const unknown = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "ghost@test.com", password: "Test@1234" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe("INVALID_CREDENTIALS");
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  it("inactive staff cannot log in", async () => {
    await prisma.staff.update({ where: { email: "driver@test.com" }, data: { active: false } });
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "driver@test.com", password: "Test@1234" });
    expect(res.status).toBe(401);
  });

  it("a staff member deactivated after login is locked out on the next request", async () => {
    const agent = await loginAs(app, "driver@test.com");
    await prisma.staff.update({ where: { email: "driver@test.com" }, data: { active: false } });
    expect((await agent.get("/auth/me")).status).toBe(401);
  });

  it("no cookie means 401", async () => {
    const res = await request(app.getHttpServer()).get("/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHENTICATED");
  });

  it("a forged cookie means 401", async () => {
    const res = await request(app.getHttpServer()).get("/auth/me").set("Cookie", "token=abc.def.ghi");
    expect(res.status).toBe(401);
  });

  it("logout clears the session cookie", async () => {
    const agent = await loginAs(app, "admin@test.com");
    await agent.post("/auth/logout").expect(200);
    expect((await agent.get("/auth/me")).status).toBe(401);
  });

  it("login body is validated with a fields map", async () => {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "not-an-email", password: "" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.fields.email).toBeDefined();
    expect(res.body.fields.password).toBeDefined();
  });

  it("seeding twice does not duplicate anything", async () => {
    const { seedAuth } = await import("../prisma/seed-auth");
    await seedAuth(prisma);
    expect(await prisma.staff.count()).toBe(4);
    expect(await prisma.role.count()).toBe(4);
  });
});
