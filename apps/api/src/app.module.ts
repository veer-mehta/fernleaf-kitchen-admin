import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { APP_FILTER, APP_PIPE } from "@nestjs/core";
import { ZodValidationPipe } from "nestjs-zod";
import { AuthModule } from "./auth/auth.module";
import { BillingModule } from "./billing/billing.module";
import { CatalogueModule } from "./catalogue/catalogue.module";
import { CompaniesModule } from "./companies/companies.module";
import { ClockModule } from "./common/clock";
import { originCheck } from "./common/origin-check";
import { HttpExceptionFilter } from "./common/http-exception.filter";
import { DashboardModule } from "./dashboard/dashboard.module";
import { DemoModule } from "./demo/demo.module";
import { DispatchModule } from "./dispatch/dispatch.module";
import { DriverModule } from "./driver/driver.module";
import { EmployeesModule } from "./employees/employees.module";
import { HealthController } from "./health/health.controller";
import { KitchenModule } from "./kitchen/kitchen.module";
import { MenuModule } from "./menu/menu.module";
import { OrdersModule } from "./orders/orders.module";
import { PricingModule } from "./pricing/pricing.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ReferenceModule } from "./reference/reference.module";
import { SettingsModule } from "./settings/settings.module";
import { StaffModule } from "./staff/staff.module";

@Module({
  imports: [PrismaModule, ClockModule, AuthModule, StaffModule, ReferenceModule, CatalogueModule, PricingModule, MenuModule, SettingsModule, CompaniesModule, EmployeesModule, OrdersModule, KitchenModule, DispatchModule, DriverModule, BillingModule, DashboardModule, DemoModule],
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
    consumer.apply(helmet(), originCheck, cookieParser()).forRoutes("*path");
  }
}
