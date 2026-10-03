import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp, loginAs, resetAndSeedAuth } from "./helpers/app";

// A few real bytes of each format are enough: the server only looks at the first bytes.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("fake jpeg body")]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("fake png body")]);

describe("image upload (e2e)", () => {
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

  it("stores an uploaded photo and serves the same bytes back", async () => {
    const driver = await loginAs(app, "driver@test.com");
    const up = await driver.post("/images").set("Content-Type", "image/jpeg").send(JPEG);
    expect(up.status).toBe(201);
    expect(up.body.url).toMatch(/^\/images\/\d+$/);

    const got = await driver.get(up.body.url).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(got.status).toBe(200);
    expect(got.headers["content-type"]).toBe("image/jpeg");
    expect(Buffer.compare(got.body as Buffer, JPEG)).toBe(0);
    expect(got.headers["cache-control"]).toContain("private");
  });

  it("trusts the bytes, not the label the client put on them", async () => {
    const admin = await loginAs(app, "admin@test.com");
    const up = await admin.post("/images").set("Content-Type", "image/jpeg").send(PNG);
    expect(up.status).toBe(201);
    const got = await admin.get(up.body.url);
    expect(got.headers["content-type"]).toBe("image/png");
  });

  it("refuses a file that is not a JPEG, PNG or WebP image", async () => {
    const admin = await loginAs(app, "admin@test.com");
    const res = await admin.post("/images").set("Content-Type", "image/jpeg").send(Buffer.from("<svg onload=alert(1)>"));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_IMAGE");
    expect(await prisma.storedImage.count()).toBe(0);
  });

  it("refuses an empty upload and a non-image content type", async () => {
    const admin = await loginAs(app, "admin@test.com");
    expect((await admin.post("/images").set("Content-Type", "image/png").send(Buffer.alloc(0))).status).toBe(400);
    expect((await admin.post("/images").send({ hello: "world" })).status).toBe(400);
  });

  it("refuses a file over 1 MB with a clear message", async () => {
    const admin = await loginAs(app, "admin@test.com");
    const big = Buffer.concat([JPEG, Buffer.alloc(1024 * 1024)]);
    const res = await admin.post("/images").set("Content-Type", "image/jpeg").send(big);
    expect(res.status).toBe(413);
    expect(res.body.code).toBe("PAYLOAD_TOO_LARGE");
    expect(res.body.message).toContain("1 MB");
  });

  it("needs a signed-in staff member to upload or view", async () => {
    const admin = await loginAs(app, "admin@test.com");
    const up = await admin.post("/images").set("Content-Type", "image/jpeg").send(JPEG);
    expect((await request(app.getHttpServer()).post("/images").set("Content-Type", "image/jpeg").send(JPEG)).status).toBe(401);
    expect((await request(app.getHttpServer()).get(up.body.url)).status).toBe(401);
  });

  it("answers 404 for an unknown or malformed image id", async () => {
    const admin = await loginAs(app, "admin@test.com");
    expect((await admin.get("/images/999")).status).toBe(404);
    expect((await admin.get("/images/abc")).status).toBe(404);
  });
});
