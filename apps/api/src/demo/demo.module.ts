import { Module } from "@nestjs/common";
import { DemoController } from "./demo.controller";
import { DemoScheduler } from "./demo.scheduler";
import { DemoService } from "./demo.service";

// Like the cut-off job, the scheduler is switched off in tests (JOBS_ENABLED=false).
const jobsEnabled = process.env.JOBS_ENABLED !== "false";

@Module({ controllers: [DemoController], providers: [DemoService, ...(jobsEnabled ? [DemoScheduler] : [])] })
export class DemoModule {}
