import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import cookieParser from "cookie-parser";
import { APP_FILTER, APP_PIPE } from "@nestjs/core";
import { ZodValidationPipe } from "nestjs-zod";
import { AuthModule } from "./auth/auth.module";
import { CatalogueModule } from "./catalogue/catalogue.module";
import { ClockModule } from "./common/clock";
import { HttpExceptionFilter } from "./common/http-exception.filter";
import { HealthController } from "./health/health.controller";
import { MenuModule } from "./menu/menu.module";
import { PricingModule } from "./pricing/pricing.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ReferenceModule } from "./reference/reference.module";
import { StaffModule } from "./staff/staff.module";

@Module({
  imports: [PrismaModule, ClockModule, AuthModule, StaffModule, ReferenceModule, CatalogueModule, PricingModule, MenuModule],
  controllers: [HealthController],
  providers: [
    // Registered as providers (not in main.ts) so e2e tests get them too.
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
  ],
})
export class AppModule implements NestModule {
  // Registered here, not in main.ts, so the e2e tests run with exactly the same middleware.
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(cookieParser()).forRoutes("*path");
  }
}
