import { Injectable } from "@nestjs/common";
import { Clock } from "../common/clock";
import { fromDateString } from "../common/dates";
import { PrismaService } from "../prisma/prisma.service";
import { loadKitchenSettings } from "../settings/load-settings";
import { kitchenToday } from "@fernleaf/shared";
import { seedDemoCatalogue } from "./demo-catalogue";
import { DemoSummary, rebaseDemoOrders } from "./demo-orders";

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

  // Runs refresh() only when the review day has no demo orders yet, e.g. the first start on a new day.
  async ensureToday(): Promise<DemoSummary | null> {
    const settings = await loadKitchenSettings(this.prisma);
    const today = kitchenToday(this.clock.now(), settings.timezone);
    const hasToday = await this.prisma.order.count({ where: { isDemo: true, deliveryDate: fromDateString(today) } });
    return hasToday > 0 ? null : this.refresh();
  }
}
