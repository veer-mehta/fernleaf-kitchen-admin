import { Injectable } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { PERMISSIONS } from "@fernleaf/shared";
import { DomainError } from "../common/domain-error";
import { PrismaService } from "../prisma/prisma.service";

// Never select passwordHash into anything that leaves the API.
const publicFields = {
  id: true,
  email: true,
  name: true,
  active: true,
  role: { select: { id: true, name: true } },
} as const;

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.staff.findMany({ select: publicFields, orderBy: { name: "asc" }, take: 200 });
  }

  // Active staff whose role holds the driver permission (for choosing default drivers and assigning drops).
  listDrivers() {
    return this.prisma.staff.findMany({
      where: { active: true, role: { permissions: { some: { permission: { code: PERMISSIONS.DRIVER_OWN_DROPS } } } } },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    });
  }

  listRoles() {
    return this.prisma.role.findMany({ orderBy: { name: "asc" } });
  }

  async create(input: { email: string; name: string; password: string; roleId: number }) {
    await this.assertRoleExists(input.roleId);
    if (await this.prisma.staff.findUnique({ where: { email: input.email } })) {
      throw new DomainError("EMAIL_TAKEN", "Email is already in use", 409, {
        email: "Email is already in use",
      });
    }
    return this.prisma.staff.create({
      data: {
        email: input.email,
        name: input.name,
        roleId: input.roleId,
        passwordHash: await bcrypt.hash(input.password, 10),
      },
      select: publicFields,
    });
  }

  async update(
    id: number,
    actorId: number,
    input: { name?: string; roleId?: number; active?: boolean; password?: string },
  ) {
    if (!(await this.prisma.staff.findUnique({ where: { id } }))) {
      throw new DomainError("NOT_FOUND", "Staff member not found", 404);
    }
    if (input.roleId !== undefined) await this.assertRoleExists(input.roleId);
    // Stops an admin locking themselves out of the panel.
    if (input.active === false && id === actorId) {
      throw new DomainError("CANNOT_DEACTIVATE_SELF", "You cannot deactivate your own account", 400);
    }
    return this.prisma.staff.update({
      where: { id },
      data: {
        name: input.name,
        roleId: input.roleId,
        active: input.active,
        passwordHash: input.password ? await bcrypt.hash(input.password, 10) : undefined,
      },
      select: publicFields,
    });
  }

  private async assertRoleExists(roleId: number) {
    if (!(await this.prisma.role.findUnique({ where: { id: roleId } }))) {
      throw new DomainError("ROLE_NOT_FOUND", "Role does not exist", 400, { roleId: "Unknown role" });
    }
  }
}
