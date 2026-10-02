import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp, loginAs, resetAndSeedAuth } from "./helpers/app";

describe("staff management (e2e)", () => {
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

  const kitchenRoleId = () => prisma.role.findUniqueOrThrow({ where: { name: "Kitchen" } }).then((r) => r.id);

  it("admin creates a staff member who can then log in, without leaking the hash", async () => {
    const admin = await loginAs(app, "admin@test.com");
    const res = await admin
      .post("/staff")
      .send({ email: "New@Test.com", name: "Nia", password: "Password1", roleId: await kitchenRoleId() });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe("new@test.com");
    expect(res.body.passwordHash).toBeUndefined();

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "new@test.com", password: "Password1" });
    expect(login.status).toBe(200);
  });

  it("rejects a duplicate email with a field error", async () => {
    const admin = await loginAs(app, "admin@test.com");
    const res = await admin
      .post("/staff")
      .send({ email: "kitchen@test.com", name: "Dup", password: "Password1", roleId: await kitchenRoleId() });
    expect(res.status).toBe(409);
    expect(res.body.fields.email).toBeDefined();
  });

  it("rejects an unknown role", async () => {
    const admin = await loginAs(app, "admin@test.com");
    const res = await admin
      .post("/staff")
      .send({ email: "x@test.com", name: "X", password: "Password1", roleId: 9999 });
    expect(res.status).toBe(400);
    expect(res.body.fields.roleId).toBeDefined();
  });

  it("an admin cannot deactivate themselves", async () => {
    const admin = await loginAs(app, "admin@test.com");
    const me = await admin.get("/auth/me");
    const res = await admin.patch(`/staff/${me.body.id}`).send({ active: false });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("CANNOT_DEACTIVATE_SELF");
  });

  it("changing a role takes effect on the very next request", async () => {
    const admin = await loginAs(app, "admin@test.com");
    const driver = await loginAs(app, "driver@test.com");
    const kitchen = await prisma.staff.findUniqueOrThrow({ where: { email: "driver@test.com" } });
    await admin.patch(`/staff/${kitchen.id}`).send({ roleId: await kitchenRoleId() });
    const me = await driver.get("/auth/me");
    expect(me.body.role).toBe("Kitchen");
  });
});
