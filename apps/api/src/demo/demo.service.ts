import { Injectable } from "@nestjs/common";
import { Clock } from "../common/clock";
import { PrismaService } from "../prisma/prisma.service";
import { loadKitchenSettings } from "../settings/load-settings";
import { kitchenToday } from "@fernleaf/shared";
import { seedDemoCatalogue } from "./demo-catalogue";
import { DEMO_MARKER_KEY, DemoSummary, rebaseDemoOrders } from "./demo-orders";

@Injectable()
export class DemoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  // Rebuilds the demo orders around today (and makes sure the catalogue exists). Only rows marked
  // isDemo are ever replaced: orders that people create by hand are never touched.
  async refresh(): Promise<DemoSummary> {
    await seedDemoCatalogue(this.prisma);
    return rebaseDemoOrders(this.prisma, this.clock.now());
  }

  // Runs refresh() once per kitchen day, e.g. the first start on a new day or the first hourly check after midnight. It goes by the
  // day recorded after the last refresh, not by whether demo orders exist for today: yesterday's refresh already
  // created next week's orders, but only as untouched future work, so today still needs building.
  async ensureToday(): Promise<DemoSummary | null> {
    const settings = await loadKitchenSettings(this.prisma);
    const today = kitchenToday(this.clock.now(), settings.timezone);
    const last = await this.prisma.setting.findUnique({ where: { key: DEMO_MARKER_KEY } });
    return last?.value === today ? null : this.refresh();
  }
}
