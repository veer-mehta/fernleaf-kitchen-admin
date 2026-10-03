import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DemoService } from "./demo.service";

// Keeps the demo data around "today" without anyone pressing a button: once when the server
// starts (free hosting sleeps and wakes, so a new day often starts with a start-up) and once
// a night. It does nothing when today already has demo orders.
@Injectable()
export class DemoScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(DemoScheduler.name);

  constructor(private readonly demo: DemoService) {}

  onApplicationBootstrap() {
    void this.run();
  }

  @Cron("0 1 * * *", { timeZone: "Asia/Kolkata" })
  async run() {
    try {
      const summary = await this.demo.ensureToday();
      if (summary) this.logger.log(`Demo data re-based to ${summary.today}: ${summary.orders} orders, ${summary.drops} drops`);
    } catch (e) {
      this.logger.error("Demo data refresh failed", e instanceof Error ? e.stack : String(e));
    }
  }
}
