import { PrismaClient } from "@prisma/client";
import { seedAuth } from "./seed-auth";

const prisma = new PrismaClient();

async function main() {
  await seedAuth(prisma);
  console.log("Seeded roles, permissions and test accounts");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
