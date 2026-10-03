import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { DiscoveryService } from "@nestjs/core";
import { INestApplication } from "@nestjs/common";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import request from "supertest";
import { PUBLIC_KEY } from "../src/auth/public.decorator";
import { AUTHENTICATED_KEY, PERMISSION_KEY } from "../src/auth/require-permission.decorator";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp, loginAs, resetAndSeedAuth } from "./helpers/app";

interface Route {
  method: "get" | "post" | "put" | "patch" | "delete";
  path: string;
  access: { kind: "public" } | { kind: "authenticated" } | { kind: "permission"; code: string } | { kind: "none" };
}

const METHOD_NAMES: Record<number, Route["method"]> = {
  [RequestMethod.GET]: "get", [RequestMethod.POST]: "post", [RequestMethod.PUT]: "put", [RequestMethod.PATCH]: "patch", [RequestMethod.DELETE]: "delete",
};

// Walks every controller the running app really has and reads what each route declares.
function collectRoutes(app: INestApplication): Route[] {
  const discovery = app.get(DiscoveryService, { strict: false });
  const routes: Route[] = [];
  for (const wrapper of discovery.getControllers()) {
    const type = wrapper.metatype as (new (...a: never[]) => unknown) | null;
    if (!type) continue;
    const controllerPath = (Reflect.getMetadata(PATH_METADATA, type) as string | undefined) ?? "";
    for (const name of Object.getOwnPropertyNames(type.prototype)) {
      const handler = (type.prototype as Record<string, unknown>)[name];
      if (typeof handler !== "function") continue;
      const methodPath = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
      if (methodPath === undefined || method === undefined) continue;

      const read = (key: string) => Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, type);
      const code = read(PERMISSION_KEY) as string | undefined;
      const access: Route["access"] = read(PUBLIC_KEY) ? { kind: "public" } : code ? { kind: "permission", code } : read(AUTHENTICATED_KEY) ? { kind: "authenticated" } : { kind: "none" };
      const path = "/" + [controllerPath, methodPath].filter(Boolean).join("/").replace(/\/+/g, "/").replace(/^\//, "").replace(/\/$/, "");
      routes.push({ method: METHOD_NAMES[method], path, access });
    }
  }
  return routes;
}
// "/orders/:id/place" -> "/orders/999999/place": an id that does not exist, so nothing real is touched.
const concrete = (path: string) => path.replace(/:\w+/g, "999999");

describe("route access (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let routes: Route[];

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await resetAndSeedAuth(prisma);
    routes = collectRoutes(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it("finds the whole API: as many routes as there are HTTP decorators in the controller source files", () => {
    let decorators = 0;
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name.endsWith(".controller.ts")) decorators += (readFileSync(full, "utf8").match(/@(Get|Post|Put|Patch|Delete)\(/g) ?? []).length;
      }
    };
    walk(join(__dirname, "../src"));
    expect(routes.length).toBe(decorators);
    expect(routes.length).toBeGreaterThan(80);
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual(expect.arrayContaining(["post /auth/login", "get /health", "get /orders/:id", "post /kitchen/units/:id/start", "post /invoices"]));
  });

  it("every route says who may use it: public, any signed-in user, or a named permission", () => {
    const undeclared = routes.filter((r) => r.access.kind === "none").map((r) => `${r.method} ${r.path}`);
    expect(undeclared).toEqual([]);
  });

  it("only login, logout and the health check are public", () => {
    const open = routes.filter((r) => r.access.kind === "public").map((r) => `${r.method} ${r.path}`).sort();
    expect(open).toEqual(["get /health", "post /auth/login", "post /auth/logout"]);
  });

  it("every permission a route asks for is a real permission code", async () => {
    const known = new Set((await prisma.permission.findMany()).map((p) => p.code));
    const unknown = routes.flatMap((r) => (r.access.kind === "permission" && !known.has(r.access.code) ? [`${r.method} ${r.path} -> ${r.access.code}`] : []));
    expect(unknown).toEqual([]);
  });

  it("an anonymous visitor is turned away from every non-public route", async () => {
    for (const r of routes.filter((r) => r.access.kind !== "public")) {
      const res = await request(app.getHttpServer())[r.method](concrete(r.path)).send({});
      expect({ route: `${r.method} ${r.path}`, status: res.status }).toEqual({ route: `${r.method} ${r.path}`, status: 401 });
    }
  });

  // The full matrix: each of the four accounts against EVERY route. An account without the route's
  // permission must get 403. One with it must get past the guards (anything but 401 or 403).
  it.each(["admin@test.com", "kitchen@test.com", "dispatch@test.com", "driver@test.com"])("%s: allowed exactly where its role has the permission", async (email) => {
    const agent = await loginAs(app, email);
    const mine = new Set<string>((await agent.get("/auth/me")).body.permissions);
    const wrong: string[] = [];

    for (const r of routes) {
      if (r.access.kind === "public") continue;
      const allowed = r.access.kind === "authenticated" || (r.access.kind === "permission" && mine.has(r.access.code));
      // Routes with a heavy side effect are only probed where the answer must be "no".
      if (allowed && `${r.method} ${r.path}` === "post /demo/refresh") continue;
      const res = await agent[r.method](concrete(r.path)).send({});
      const ok = allowed ? res.status !== 401 && res.status !== 403 : res.status === 403;
      if (!ok) wrong.push(`${r.method} ${r.path} -> ${res.status} (expected ${allowed ? "not 401/403" : "403"})`);
    }
    expect(wrong).toEqual([]);
  });

  it("the four roles really do differ: nobody but admin reaches settings, billing, pricing, companies or staff", async () => {
    const forbiddenForOthers = ["get /settings", "get /invoices", "get /tiers", "get /employees", "get /staff", "post /demo/refresh", "post /orders/process-cutoff"];
    for (const email of ["kitchen@test.com", "dispatch@test.com", "driver@test.com"]) {
      const agent = await loginAs(app, email);
      for (const entry of forbiddenForOthers) {
        const [method, path] = entry.split(" ");
        expect({ email, entry, status: (await agent[method as Route["method"]](path).send({})).status }).toEqual({ email, entry, status: 403 });
      }
    }
  });

  it("the driver can only ever see its own drops: no endpoint takes a driver id to look at", () => {
    const driverRoutes = routes.filter((r) => r.access.kind === "permission" && r.access.code === "driver:own-drops").map((r) => r.path);
    expect(driverRoutes.sort()).toEqual(["/dashboard/driver", "/driver/drops", "/driver/drops/:id/delivered"]);
    expect(driverRoutes.some((p) => /driverId|:driver/.test(p))).toBe(false);
  });

  it("no code decides anything by a role's name (permissions only, so a new role is just new rows)", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name.endsWith(".ts") && !name.endsWith(".spec.ts")) files.push(full);
      }
    };
    walk(join(__dirname, "../src"));
    const offenders = files.flatMap((file) =>
      readFileSync(file, "utf8").split("\n").flatMap((line, i) => (/\brole(\.name)?\s*[!=]==?\s*["'`]/.test(line) || /["'`](Admin|Kitchen|Dispatch|Driver)["'`]\s*[!=]==/.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : [])),
    );
    expect(offenders).toEqual([]);
  });
});
