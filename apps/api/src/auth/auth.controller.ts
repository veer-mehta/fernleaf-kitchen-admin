import { Body, Controller, Get, HttpCode, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { createZodDto } from "nestjs-zod";
import { LoginInput, Me } from "@fernleaf/shared";
import { AuthService } from "./auth.service";
import { AuthUser, CurrentUser } from "./auth-user";
import { AUTH_COOKIE } from "./jwt-auth.guard";
import { Public } from "./public.decorator";
import { Authenticated } from "./require-permission.decorator";

class LoginDto extends createZodDto(LoginInput) {}

const TWELVE_HOURS = 12 * 60 * 60 * 1000;

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response) {
    const token = await this.auth.login(body.email, body.password);
    // httpOnly: JavaScript in the browser can never read the token (protects against XSS theft).
    res.cookie(AUTH_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: TWELVE_HOURS,
    });
    return { ok: true };
  }

  @Public()
  @Post("logout")
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(AUTH_COOKIE);
    return { ok: true };
  }

  @Authenticated()
  @Get("me")
  me(@CurrentUser() user: AuthUser): Me {
    return user;
  }
}
