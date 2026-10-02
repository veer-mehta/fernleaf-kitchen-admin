import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { DomainError } from "../common/domain-error";
import { PrismaService } from "../prisma/prisma.service";

// A real bcrypt hash of a random string. Compared against when the email is unknown so a
// missing account takes about as long as a wrong password (no account-guessing by timing).
const DUMMY_HASH = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8.e4G4m6mY0xXyY4n9W3m3Zr5H0e9e";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  // Returns a signed token for valid credentials, otherwise throws the same error either way.
  async login(email: string, password: string): Promise<string> {
    const staff = await this.prisma.staff.findUnique({ where: { email } });
    const ok = await bcrypt.compare(password, staff?.passwordHash ?? DUMMY_HASH);
    if (!staff || !staff.active || !ok) {
      throw new DomainError("INVALID_CREDENTIALS", "Email or password is incorrect", 401);
    }
    return this.jwt.signAsync({ sub: staff.id });
  }
}
