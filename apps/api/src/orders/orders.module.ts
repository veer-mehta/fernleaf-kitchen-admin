import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { MenuModule } from "../menu/menu.module";
import { CutoffProcessor } from "./cutoff-processor.service";
import { CutoffScheduler } from "./cutoff.scheduler";
import { OrderBuilder } from "./order-builder";
import { OrdersController } from "./orders.controller";
import { OrdersQueryService } from "./orders-query.service";
import { OrdersService } from "./orders.service";

// Tests switch the background job off (JOBS_ENABLED=false) so it cannot touch test data mid-test.
const jobsEnabled = process.env.JOBS_ENABLED !== "false";

@Module({
  imports: [MenuModule, ScheduleModule.forRoot()],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersQueryService, OrderBuilder, CutoffProcessor, ...(jobsEnabled ? [CutoffScheduler] : [])],
  exports: [OrdersQueryService, CutoffProcessor],
})
export class OrdersModule {}
