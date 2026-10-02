import { Module } from "@nestjs/common";
import { APP_FILTER, APP_PIPE } from "@nestjs/core";
import { ZodValidationPipe } from "nestjs-zod";
import { ClockModule } from "./common/clock";
import { HttpExceptionFilter } from "./common/http-exception.filter";
import { HealthController } from "./health/health.controller";
import { PrismaModule } from "./prisma/prisma.module";

@Module({
  imports: [PrismaModule, ClockModule],
  controllers: [HealthController],
  providers: [
    // Registered as providers (not in main.ts) so e2e tests get them too.
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
  ],
})
export class AppModule {}
