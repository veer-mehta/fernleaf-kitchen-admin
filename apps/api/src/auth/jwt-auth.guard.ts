import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { DomainError } from "../common/domain-error";
import { PrismaService } from "../prisma/prisma.service";
import { AuthUser } from "./auth-user";
import { PUBLIC_KEY } from "./public.decorator";

export const AUTH_COOKIE = "token";

// Runs first on every request: who is this? Sets request.user.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const token = request.cookies?.[AUTH_COOKIE];
    if (!token) throw this.unauthenticated();

    let staffId: number;
    try {
      staffId = (await this.jwt.verifyAsync<{ sub: number }>(token)).sub;
    } catch {
      throw this.unauthenticated();
    }

    // Load the staff member and their permissions on every request instead of trusting the
    // token: deactivating someone or changing their role takes effect immediately.
    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    if (!staff || !staff.active) throw this.unauthenticated();

    const user: AuthUser = {
      id: staff.id,
      email: staff.email,
      name: staff.name,
      role: staff.role.name,
      // Sorted so the list is stable (the database returns rows in no guaranteed order).
      permissions: staff.role.permissions.map((rp) => rp.permission.code).sort(),
    };
    request.user = user;
    return true;
  }

  private unauthenticated() {
    return new DomainError("UNAUTHENTICATED", "Please sign in", 401);
  }
}
