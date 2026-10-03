import { Prisma } from "@prisma/client";
import { fromDateString } from "../common/dates";

// Orders for the same company, address and exact delivery time are handled together as one "drop".
// Finds that drop or creates it (new drops start with the company's default driver).
//
// "INSERT ... ON CONFLICT DO NOTHING" is used instead of Prisma's upsert on purpose: if two
// requests create the same drop at the same instant, the database quietly lets one win and the
// other simply reads it, instead of one of them failing with a unique-constraint error.
export async function findOrCreateDrop(
  tx: Prisma.TransactionClient,
  key: { companyId: number; addressId: number; deliveryDate: string; deliveryTime: string },
) {
  const company = await tx.company.findUniqueOrThrow({ where: { id: key.companyId }, select: { defaultDriverId: true } });
  await tx.$executeRaw`
    INSERT INTO "Drop" ("companyId", "addressId", "deliveryDate", "deliveryTime", "driverId")
    VALUES (${key.companyId}, ${key.addressId}, ${key.deliveryDate}::date, ${key.deliveryTime}, ${company.defaultDriverId})
    ON CONFLICT ("companyId", "addressId", "deliveryDate", "deliveryTime") DO NOTHING`;
  return tx.drop.findUniqueOrThrow({
    where: {
      companyId_addressId_deliveryDate_deliveryTime: {
        companyId: key.companyId,
        addressId: key.addressId,
        deliveryDate: fromDateString(key.deliveryDate),
        deliveryTime: key.deliveryTime,
      },
    },
  });
}

// A drop with no orders left (they were all cancelled or moved) is removed.
export async function deleteDropIfEmpty(tx: Prisma.TransactionClient, dropId: number | null) {
  if (dropId === null) return;
  if ((await tx.order.count({ where: { dropId } })) === 0) await tx.drop.deleteMany({ where: { id: dropId } });
}
