import { Injectable } from "@nestjs/common";
import { OrderStatus } from "@prisma/client";
import { DateTime } from "luxon";
import { kitchenToday } from "@fernleaf/shared";
import { AuthUser } from "../auth/auth-user";
import { BillingService } from "../billing/billing.service";
import { Clock } from "../common/clock";
import { fromDateString, toDateString } from "../common/dates";
import { DispatchService } from "../dispatch/dispatch.service";
import { DriverService } from "../driver/driver.service";
import { KitchenService } from "../kitchen/kitchen.service";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.service";

const ALL_STATUSES: OrderStatus[] = ["DRAFT", "PLACED", "CONFIRMED", "DELIVERED", "CANCELLED", "REJECTED"];
// Cancelled and rejected orders are never counted as business, unless a figure says otherwise.
const NOT_COUNTED: OrderStatus[] = ["CANCELLED", "REJECTED"];

// Each dashboard is a summary of what the person's own board already shows. The kitchen, dispatch
// and driver figures come straight from those boards' services, so a dashboard can never disagree with its board.
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
    private readonly billing: BillingService,
    private readonly kitchen: KitchenService,
    private readonly dispatch: DispatchService,
    private readonly driver: DriverService,
  ) {}

  private async today(): Promise<string> {
    const { timezone } = await this.settings.getKitchenSettings();
    return kitchenToday(this.clock.now(), timezone);
  }

  // ---------- admin ----------

  async admin(query: { date?: string }) {
    const today = await this.today();
    const date = query.date ?? today;

    // 1. Orders of the chosen DELIVERY date, by status.
    const grouped = await this.prisma.order.groupBy({
      by: ["status"],
      where: { deliveryDate: fromDateString(date) },
      _count: { _all: true },
      _sum: { totalCents: true },
    });
    const ordersByStatus = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>;
    let activeOrders = 0;
    let activeValueCents = 0;
    for (const g of grouped) {
      ordersByStatus[g.status] = g._count._all;
      if (!NOT_COUNTED.includes(g.status)) {
        activeOrders += g._count._all;
        activeValueCents += g._sum.totalCents ?? 0;
      }
    }

    // 2. What companies owe and have not been invoiced for (all dates), straight from billing.
    const waiting = await this.billing.uninvoiced();
    const uninvoiced = {
      totalCents: waiting.companies.reduce((sum, c) => sum + c.totalCents, 0),
      orderCount: waiting.companies.reduce((sum, c) => sum + c.orderCount, 0),
      companies: waiting.companies.map((c) => ({ companyId: c.companyId, companyName: c.companyName, orderCount: c.orderCount, totalCents: c.totalCents })),
    };

    // 3. Orders to deliver over the next 7 days (today and the 6 days after), by delivery date.
    const from = DateTime.fromISO(today, { zone: "utc" });
    const days = Array.from({ length: 7 }, (_, i) => from.plus({ days: i }).toISODate()!);
    const upcomingRows = await this.prisma.order.groupBy({
      by: ["deliveryDate"],
      where: { deliveryDate: { gte: fromDateString(days[0]), lte: fromDateString(days[6]) }, status: { notIn: NOT_COUNTED } },
      _count: { _all: true },
    });
    const countByDay = new Map(upcomingRows.map((r) => [toDateString(r.deliveryDate), r._count._all]));
    const upcoming = {
      from: days[0],
      to: days[6],
      total: [...countByDay.values()].reduce((a, b) => a + b, 0),
      days: days.map((d) => ({ date: d, count: countByDay.get(d) ?? 0 })),
    };

    // 4. Active dishes and options that a tier does not sell (no price row), per tier.
    const tiers = await this.prisma.priceTier.findMany({ orderBy: { id: "asc" } });
    const perTier = await Promise.all(
      tiers.map(async (t) => ({
        tierId: t.id,
        name: t.name,
        dishes: await this.prisma.dish.count({ where: { active: true, prices: { none: { tierId: t.id } } } }),
        options: await this.prisma.option.count({ where: { active: true, prices: { none: { tierId: t.id } } } }),
      })),
    );
    const missingPrices = { total: perTier.reduce((sum, t) => sum + t.dishes + t.options, 0), tiers: perTier };

    return { date, ordersByStatus, activeOrders, activeValueCents, uninvoiced, upcoming, missingPrices };
  }

  // ---------- kitchen ----------

  async kitchenDashboard(query: { date?: string }) {
    const board = await this.kitchen.board({ date: query.date });
    const stations = board.stations.map((s) => ({ stationId: s.stationId, name: s.name, counts: s.counts }));

    // The orders whose food is due soonest and not finished yet.
    const pending = new Map<number, { orderId: number; companyName: string; plannedKitchenReadyAt: Date; unitsLeft: number; urgency: string }>();
    for (const station of board.stations) {
      for (const unit of station.units) {
        if (unit.status === "DONE") continue;
        const entry = pending.get(unit.orderId) ?? {
          orderId: unit.orderId, companyName: unit.companyName, plannedKitchenReadyAt: unit.plannedKitchenReadyAt, unitsLeft: 0, urgency: unit.urgency,
        };
        entry.unitsLeft += 1;
        pending.set(unit.orderId, entry);
      }
    }
    const nextDeadlines = [...pending.values()]
      .sort((a, b) => a.plannedKitchenReadyAt.getTime() - b.plannedKitchenReadyAt.getTime() || a.orderId - b.orderId)
      .slice(0, 5);
    return { date: board.date, totals: board.totals, stations, nextDeadlines };
  }

  // ---------- dispatch ----------

  async dispatchDashboard(query: { date?: string }) {
    const board = await this.dispatch.board({ date: query.date });

    // Rate = drops delivered on time / drops delivered. With nothing delivered there is no rate (null), never 0%.
    const deliveredDrops = await this.prisma.drop.findMany({
      where: { deliveryDate: fromDateString(board.date), status: "DELIVERED" },
      include: { orders: { where: { status: "DELIVERED" }, select: { onTime: true }, take: 1 } },
    });
    const onTime = deliveredDrops.filter((d) => d.orders[0]?.onTime === true).length;
    const delivered = deliveredDrops.length;

    return {
      date: board.date,
      totals: board.totals,
      onTime: { delivered, onTime, late: delivered - onTime, ratePercent: delivered === 0 ? null : Math.round((onTime * 100) / delivered) },
      lateDrops: board.drops.filter((d) => d.late).map((d) => ({ id: d.id, company: d.company.name, deliveryTime: d.deliveryTime, status: d.status })),
    };
  }

  // ---------- driver ----------

  async driverDashboard(user: AuthUser) {
    const list = await this.driver.list(user);
    const delivered = list.drops.filter((d) => d.status === "DELIVERED").length;
    return {
      date: list.date,
      counts: { total: list.drops.length, delivered, remaining: list.drops.length - delivered },
      drops: list.drops.map((d) => ({ id: d.id, deliveryTime: d.deliveryTime, company: d.company.name, status: d.status })),
    };
  }
}
