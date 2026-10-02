import { createParamDecorator, ExecutionContext } from "@nestjs/common";

// The logged-in staff member attached to the request by JwtAuthGuard.
export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: string;
  permissions: string[];
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().user as AuthUser;
});
