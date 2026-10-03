import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module";
import { DispatchModule } from "../dispatch/dispatch.module";
import { DriverModule } from "../driver/driver.module";
import { KitchenModule } from "../kitchen/kitchen.module";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";

@Module({
  imports: [BillingModule, KitchenModule, DispatchModule, DriverModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
