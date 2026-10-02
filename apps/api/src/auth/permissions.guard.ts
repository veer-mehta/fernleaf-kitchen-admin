import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { DomainError } from "../common/domain-error";
import { AuthUser } from "./auth-user";
import { PUBLIC_KEY } from "./public.decorator";
import { AUTHENTICATED_KEY, PERMISSION_KEY } from "./require-permission.decorator";

// Runs second: may this user do this? Checks permission codes, never role names.
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const user = context.switchToHttp().getRequest().user as AuthUser;
    const required = this.reflector.getAllAndOverride<string | undefined>(PERMISSION_KEY, targets);

    if (required) {
      if (user.permissions.includes(required)) return true;
      throw new DomainError("FORBIDDEN", "You do not have access to this", 403);
    }
    if (this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_KEY, targets)) return true;

    // Default deny: a route that declares nothing is closed, so forgetting a decorator
    // can never silently expose an endpoint.
    throw new DomainError("FORBIDDEN", "You do not have access to this", 403);
  }
}
