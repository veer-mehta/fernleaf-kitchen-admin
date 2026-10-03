import { INestApplication } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../../src/prisma/prisma.service";
import { fixtures } from "./fixtures";

// Delivery date used throughout the order tests: Wednesday 7 Oct 2026.
// With the default settings (2 kitchen working days, 16:00) it locks Monday 5 Oct 16:00 IST.
export const DELIVERY_DATE = "2026-10-07";
export const BEFORE_CUTOFF = "2026-10-02T10:00:00+05:30"; // Friday morning
export const AFTER_CUTOFF = "2026-10-05T16:00:00+05:30"; // exactly the cut-off instant

// One company, two addresses, one employee, and one dish "Rice Bowl" (10.00) with a required
// "Rice" group: brown (+0.00) and jeera (+0.50), all priced on the default tier.
export async function orderWorld(
  prisma: PrismaService,
  flags: { canChooseAddress?: boolean; canChangeTime?: boolean; canChangePackaging?: boolean } = {},
) {
  const f = fixtures(prisma);
  const standard = await f.tier("Standard", true);
  const company = await f.company({ name: "Acme" });
  await f.domain(company.id, "acme.com");
  const hq = await f.address(company.id, "HQ");
  const plant = await f.address(company.id, "Plant");
  const employee = await f.employee(company.id, "asha@acme.com", flags);

  const dish = await f.dish("BOWL");
  const brown = await f.option("Brown rice");
  const jeera = await f.option("Jeera rice");
  const group = await f.group(dish.id, "Rice", true, [brown.id, jeera.id]);
  const category = await f.category("Bowls");
  await f.categoryItem(category.id, dish.id);
  await f.dishPrice(standard.id, dish.id, 1000);
  await f.optionPrice(standard.id, brown.id, 0);
  await f.optionPrice(standard.id, jeera.id, 50);

  return { f, standard, company, hq, plant, employee, dish, brown, jeera, group, category };
}
export type OrderWorld = Awaited<ReturnType<typeof orderWorld>>;

// 10 bowls: 6 with brown rice (10.00 each) and 4 with jeera rice (10.50 each) = 102.00.
export const TEN_BOWLS_TOTAL = 6 * 1000 + 4 * 1050;
export function tenBowls(w: OrderWorld, over: Record<string, unknown> = {}) {
  return {
    employeeId: w.employee.id,
    deliveryDate: DELIVERY_DATE,
    lines: [
      {
        dishId: w.dish.id,
        quantity: 10,
        combinations: [
          { quantity: 6, selections: [{ groupId: w.group.id, optionId: w.brown.id }] },
          { quantity: 4, selections: [{ groupId: w.group.id, optionId: w.jeera.id }] },
        ],
      },
    ],
    ...over,
  };
}

// A staff member who may write orders but NOT override them, to prove permissions (not role names) decide.
export async function createOrderDeskStaff(prisma: PrismaService) {
  const role = await prisma.role.create({ data: { name: "Order desk" } });
  for (const code of ["orders:read", "orders:write", "dashboard:read"]) {
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code } });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
  }
  await prisma.staff.create({
    data: { email: "desk@test.com", name: "Dana Desk", roleId: role.id, passwordHash: await bcrypt.hash("Test@1234", 10) },
  });
}

export type App = INestApplication;
