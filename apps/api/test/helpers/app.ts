import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/prisma/prisma.service";
import { resetDb } from "./reset-db";
import { seedAuth } from "../../prisma/seed-auth";

export async function createTestApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app: INestApplication = moduleRef.createNestApplication();
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

// Fresh database with roles, permissions and the four test accounts.
export async function resetAndSeedAuth(prisma: PrismaService) {
  await resetDb(prisma);
  await seedAuth(prisma);
}

// A supertest "agent" keeps cookies between requests, like a browser session.
export async function loginAs(app: INestApplication, email: string, password = "Test@1234") {
  const agent = request.agent(app.getHttpServer());
  const res = await agent.post("/auth/login").send({ email, password });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}
