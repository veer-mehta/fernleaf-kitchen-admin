import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { CutoffProcessor } from "./cutoff-processor.service";

// Runs the cut-off processing in the background. Correctness never depends on it: edits are
// locked by the lazy check, and the boards also process due dates when they load. Free hosting
// can put the server to sleep, so it also runs once at start-up to catch up.
@Injectable()
export class CutoffScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(CutoffScheduler.name);

  constructor(private readonly processor: CutoffProcessor) {}

  onApplicationBootstrap() {
    void this.run();
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run() {
    try {
      const results = await this.processor.processDueDates();
      for (const r of results) this.logger.log(`Cut-off processed for ${r.date}: ${r.confirmed} confirmed, ${r.cancelled} cancelled`);
    } catch (e) {
      this.logger.error("Cut-off processing failed", e instanceof Error ? e.stack : String(e));
    }
  }
}
