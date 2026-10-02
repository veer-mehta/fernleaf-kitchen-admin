import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { ALL_PERMISSIONS } from "@fernleaf/shared";
import { ROLE_PERMISSIONS, TEST_ACCOUNTS, TEST_PASSWORD } from "./seed-data/roles";

// Idempotent: every statement is an upsert or a replace, so running it on every deploy is safe.
export async function seedAuth(prisma: PrismaClient) {
  for (const code of ALL_PERMISSIONS) {
    await prisma.permission.upsert({ where: { code }, update: {}, create: { code } });
  }

  const allPermissions = await prisma.permission.findMany();
  const idByCode = new Map(allPermissions.map((p) => [p.code, p.id]));

  const roleIds = new Map<string, number>();
  for (const [name, codes] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
    roleIds.set(name, role.id);
    // Replace the role's permission set so the seed file stays the source of truth.
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: codes.map((code) => ({ roleId: role.id, permissionId: idByCode.get(code)! })),
    });
  }

  // Passwords are reset on every seed so the documented credentials always work.
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  for (const account of TEST_ACCOUNTS) {
    const roleId = roleIds.get(account.role)!;
    await prisma.staff.upsert({
      where: { email: account.email },
      update: { name: account.name, roleId, passwordHash, active: true },
      create: { email: account.email, name: account.name, roleId, passwordHash },
    });
  }
}
