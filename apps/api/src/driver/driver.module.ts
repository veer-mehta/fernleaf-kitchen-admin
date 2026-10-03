import { Module } from "@nestjs/common";
import { DispatchModule } from "../dispatch/dispatch.module";
import { OrdersModule } from "../orders/orders.module";
import { DriverController } from "./driver.controller";
import { DriverService } from "./driver.service";

@Module({ imports: [DispatchModule, OrdersModule], controllers: [DriverController], providers: [DriverService], exports: [DriverService] })
export class DriverModule {}
