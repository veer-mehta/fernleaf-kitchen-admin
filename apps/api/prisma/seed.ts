import { PrismaClient } from "@prisma/client";
import { rebaseDemoOrders } from "../src/demo/demo-orders";
import { seedDemoCatalogue } from "../src/demo/demo-catalogue";
import { seedAuth } from "./seed-auth";

const prisma = new PrismaClient();

// Runs on every deploy and is safe to repeat: accounts first (the demo data refers to the driver),
// then the menu and companies, then orders re-based around today.
async function main() {
  await seedAuth(prisma);
  console.log("Seeded roles, permissions and the four test accounts");
  await seedDemoCatalogue(prisma);
  console.log("Seeded the demo menu, price tiers and companies");
  const summary = await rebaseDemoOrders(prisma, new Date());
  console.log(`Demo orders re-based around ${summary.today}: ${summary.orders} orders, ${summary.drops} drops, ${summary.invoices} invoices`, summary.byStatus);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
