import { Injectable } from "@nestjs/common";
import { Clock } from "../common/clock";
import { fromDateString, toDateString } from "../common/dates";
import { DomainError } from "../common/domain-error";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.service";
import { computeCutoff } from "./cutoff";
import { findOrCreateDrop } from "./drops";
import { addEvent } from "./order-events";

export interface CutoffResult {
  date: string;
  cancelled: number;
  confirmed: number;
}

// What happens when the cut-off for a delivery date passes:
//   every DRAFT is cancelled, every PLACED order is CONFIRMED (and becomes billable),
//   and confirmation creates the kitchen's prep units and puts the order into a delivery drop.
@Injectable()
export class CutoffProcessor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
  ) {}

  // Safe to run any number of times, even at the same moment: every change is a
  // "move from status X to status Y" that only succeeds for the first caller, so a second
  // run finds nothing left to do.
  async processDate(deliveryDate: string, actor = "System"): Promise<CutoffResult> {
    const settings = await this.settings.getKitchenSettings();
    const cutoffAt = computeCutoff(deliveryDate, settings);
    if (this.clock.now().getTime() < cutoffAt.getTime()) {
      throw new DomainError("CUTOFF_NOT_REACHED", `The cut-off for ${deliveryDate} has not passed yet (${cutoffAt.toISOString()})`, 409);
    }

    const date = fromDateString(deliveryDate);
    // One transaction for the whole date: either everything for the day is processed or nothing is.
    // The long timeout is for a busy day (hundreds of orders).
    return this.prisma.$transaction(
      async (tx) => {
        let cancelled = 0;
        let confirmed = 0;

        // 1. Drafts never got placed in time: cancel them.
        const drafts = await tx.order.findMany({ where: { deliveryDate: date, status: "DRAFT" }, select: { id: true } });
        for (const { id } of drafts) {
          const moved = await tx.order.updateMany({ where: { id, status: "DRAFT" }, data: { status: "CANCELLED" } });
          if (moved.count === 1) {
            cancelled += 1;
            await addEvent(tx, id, "CANCELLED", actor, { reason: "The cut-off passed while the order was still a draft" });
          }
        }

        // 2. Placed orders are now locked in: confirm them.
        const placed = await tx.order.findMany({
          where: { deliveryDate: date, status: "PLACED" },
          include: { lines: { include: { combinations: true } } },
        });
        for (const order of placed) {
          const moved = await tx.order.updateMany({ where: { id: order.id, status: "PLACED" }, data: { status: "CONFIRMED" } });
          if (moved.count === 0) continue; // somebody else got there first

          confirmed += 1;
          // One prep unit per combination, copying the station the dish had when it was ordered.
          await tx.prepUnit.createMany({
            data: order.lines.flatMap((line) =>
              line.combinations.map((combo) => ({ combinationId: combo.id, stationId: line.stationIdSnapshot })),
            ),
          });
          const drop = await findOrCreateDrop(tx, {
            companyId: order.companyId,
            addressId: order.addressId,
            deliveryDate,
            deliveryTime: order.deliveryTime,
          });
          await tx.order.update({ where: { id: order.id }, data: { dropId: drop.id } });
          await addEvent(tx, order.id, "CONFIRMED", actor);
        }

        return { date: deliveryDate, cancelled, confirmed };
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }

  // Processes every delivery date that still has drafts or placed orders and whose cut-off has passed.
  // Called by the background job and, as a safety net, whenever the kitchen or dispatch boards load.
  async processDueDates(): Promise<CutoffResult[]> {
    const pending = await this.prisma.order.groupBy({
      by: ["deliveryDate"],
      where: { status: { in: ["DRAFT", "PLACED"] } },
    });
    const settings = await this.settings.getKitchenSettings();
    const now = this.clock.now().getTime();

    const results: CutoffResult[] = [];
    for (const { deliveryDate } of pending) {
      const date = toDateString(deliveryDate);
      if (computeCutoff(date, settings).getTime() <= now) results.push(await this.processDate(date));
    }
    return results;
  }
}
