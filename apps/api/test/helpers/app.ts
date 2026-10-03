import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { Clock } from "../../src/common/clock";
import { PrismaService } from "../../src/prisma/prisma.service";
import { resetDb } from "./reset-db";
import { seedAuth } from "../../prisma/seed-auth";

// A clock tests can set. It starts at the real time; call clock.set("2026-10-02T10:00:00+05:30") to pretend.
export class FakeClock extends Clock {
  private current = new Date();
  now(): Date {
    return this.current;
  }
  set(value: string | Date) {
    this.current = new Date(value);
  }
}

export async function createTestApp() {
  const clock = new FakeClock();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue(clock)
    .compile();
  const app: INestApplication = moduleRef.createNestApplication();
  await app.init();
  return { app, prisma: app.get(PrismaService), clock };
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
