import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PermissionsGuard } from "./permissions.guard";
import { PUBLIC_KEY } from "./public.decorator";
import { AUTHENTICATED_KEY, PERMISSION_KEY } from "./require-permission.decorator";

// Build a fake request context whose handler carries the given metadata.
function ctx(metadata: Record<string, unknown>, permissions: string[]) {
  const handler = () => undefined;
  for (const [key, value] of Object.entries(metadata)) Reflect.defineMetadata(key, value, handler);
  class Controller {}
  return {
    getHandler: () => handler,
    getClass: () => Controller,
    switchToHttp: () => ({ getRequest: () => ({ user: { permissions } }) }),
  } as unknown as ExecutionContext;
}

describe("PermissionsGuard", () => {
  const guard = new PermissionsGuard(new Reflector());

  it("allows @Public routes", () => {
    expect(guard.canActivate(ctx({ [PUBLIC_KEY]: true }, []))).toBe(true);
  });

  it("allows when the user has the required permission", () => {
    expect(guard.canActivate(ctx({ [PERMISSION_KEY]: "kitchen:read" }, ["kitchen:read"]))).toBe(true);
  });

  it("rejects when the user lacks the required permission", () => {
    expect(() => guard.canActivate(ctx({ [PERMISSION_KEY]: "orders:write" }, ["kitchen:read"]))).toThrow();
  });

  it("allows @Authenticated routes for any logged-in user", () => {
    expect(guard.canActivate(ctx({ [AUTHENTICATED_KEY]: true }, []))).toBe(true);
  });

  it("denies by default when a route declares nothing", () => {
    expect(() => guard.canActivate(ctx({}, ["orders:write"]))).toThrow();
  });
});
