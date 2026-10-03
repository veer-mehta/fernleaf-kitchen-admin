import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp } from "./helpers/app";

describe("browser security (e2e)", () => {
  let app: INestApplication;
  const web = "https://panel.example.com";
  const login = { email: "admin@test.com", password: "wrong-password" };
  let previousOrigin: string | undefined;

  beforeAll(async () => {
    previousOrigin = process.env.WEB_ORIGIN;
    process.env.WEB_ORIGIN = web;
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    process.env.WEB_ORIGIN = previousOrigin;
    await app.close();
  });

  it("sends the basic security headers", async () => {
    const res = await request(app.getHttpServer()).get("/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBeDefined();
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("rejects a state-changing request from another site's page", async () => {
    const res = await request(app.getHttpServer()).post("/auth/login").set("Origin", "https://evil.example").send(login);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("BAD_ORIGIN");
  });

  it("rejects an opaque origin (sandboxed frames send 'null')", async () => {
    const res = await request(app.getHttpServer()).post("/auth/login").set("Origin", "null").send(login);
    expect(res.status).toBe(403);
  });

  it("accepts a state-changing request from the web app's own origin", async () => {
    const res = await request(app.getHttpServer()).post("/auth/login").set("Origin", web).send(login);
    expect(res.status).toBe(401); // got past the origin check; the password is wrong
  });

  it("accepts requests with no Origin header (curl, server-to-server; browsers always send one on writes)", async () => {
    const res = await request(app.getHttpServer()).post("/auth/login").send(login);
    expect(res.status).toBe(401);
  });

  it("does not check reads", async () => {
    const res = await request(app.getHttpServer()).get("/health").set("Origin", "https://evil.example");
    expect(res.status).toBe(200);
  });
});
