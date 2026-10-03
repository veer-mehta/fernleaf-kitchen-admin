import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { kitchenToday } from "@fernleaf/shared";
import { AuthUser } from "../auth/auth-user";
import { Clock } from "../common/clock";
import { fromDateString } from "../common/dates";
import { DomainError } from "../common/domain-error";
import { CutoffProcessor } from "../orders/cutoff-processor.service";
import { addEvent } from "../orders/order-events";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.service";
import { urgencyOf } from "./kitchen-status";

// "Only units of CONFIRMED orders can be worked on", written once as a filter.
const ofConfirmedOrder = { combination: { line: { order: { status: "CONFIRMED" as const } } } };

@Injectable()
export class KitchenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
    private readonly cutoff: CutoffProcessor,
  ) {}

  // ---------- the board ----------

  async board(query: { date?: string; stationId?: string }) {
    // Safety net: if the background job has not run (free hosting sleeps), confirm anything due now.
    await this.cutoff.processDueDates();

    const now = this.clock.now();
    const { timezone } = await this.settings.getKitchenSettings();
    const date = query.date ?? kitchenToday(now, timezone);

    const where: Prisma.PrepUnitWhereInput = {
      combination: { line: { order: { deliveryDate: fromDateString(date), status: "CONFIRMED" } } },
      stationId: query.stationId === "none" ? null : query.stationId ? Number(query.stationId) : undefined,
    };
    // One query with its relations loaded together (no query per unit), so a 400-order day stays quick.
    const units = await this.prisma.prepUnit.findMany({
      where,
      include: { combination: { include: { line: { include: { order: { include: { company: true } } } } } } },
      orderBy: [{ combination: { line: { order: { plannedKitchenReadyAt: "asc" } } } }, { id: "asc" }],
    });

    const stations = new Map<number | null, { stationId: number | null; name: string; units: ReturnType<typeof toRow>[] }>();
    const totals = { pending: 0, started: 0, done: 0, late: 0, atRisk: 0 };

    const toRow = (u: (typeof units)[number]) => {
      const { line } = u.combination;
      const { order } = line;
      const options = u.combination.optionsSnapshot as { optionName: string }[];
      return {
        unitId: u.id,
        orderId: order.id,
        companyName: order.company.name,
        dishName: line.dishNameSnapshot,
        optionsSummary: options.map((o) => o.optionName).join(", "),
        quantity: u.combination.quantity,
        status: u.status,
        startedAt: u.startedAt,
        doneAt: u.doneAt,
        deliveryTime: order.deliveryTime,
        plannedKitchenReadyAt: order.plannedKitchenReadyAt,
        urgency: urgencyOf(order.plannedKitchenReadyAt, now, u.status),
      };
    };

    for (const u of units) {
      const row = toRow(u);
      const station = stations.get(u.stationId) ?? {
        stationId: u.stationId,
        name: u.stationId === null ? "Unassigned" : (u.combination.line.stationNameSnapshot ?? "Station"),
        units: [],
      };
      station.units.push(row);
      stations.set(u.stationId, station);

      totals[row.status === "PENDING" ? "pending" : row.status === "STARTED" ? "started" : "done"] += 1;
      if (row.urgency === "late") totals.late += 1;
      if (row.urgency === "at_risk") totals.atRisk += 1;
    }

    const groups = [...stations.values()]
      .map((s) => ({
        ...s,
        counts: {
          pending: s.units.filter((r) => r.status === "PENDING").length,
          started: s.units.filter((r) => r.status === "STARTED").length,
          done: s.units.filter((r) => r.status === "DONE").length,
        },
      }))
      // Named stations alphabetically, Unassigned always last.
      .sort((a, b) => (a.stationId === null ? 1 : b.stationId === null ? -1 : a.name.localeCompare(b.name)));

    return { date, stations: groups, totals };
  }

  // ---------- start / finish a unit ----------
  //
  // Every change is "move from status X to status Y" written as an updateMany with the old status
  // in the WHERE clause. If two people click at once, the database applies one; the other matches
  // zero rows and gets a clear 409. Each transaction first touches the order row, which makes the
  // actions on one order's units happen one after another (needed so the "all units done" check
  // below never misses a unit that was finished at the same moment).

  async start(unitId: number, actor: AuthUser) {
    const now = this.clock.now();
    const orderId = await this.orderIdOf(unitId);

    await this.prisma.$transaction(async (tx) => {
      await this.lockOrder(tx, orderId, now);
      const moved = await tx.prepUnit.updateMany({
        where: { id: unitId, status: "PENDING", ...ofConfirmedOrder },
        data: { status: "STARTED", startedAt: now, version: { increment: 1 } },
      });
      if (moved.count === 0) throw await this.whyNot(tx, unitId);
      await this.markOrderStarted(tx, orderId, now, actor, unitId);
    });
    return { unitId, status: "STARTED" as const };
  }

  async finish(unitId: number, actor: AuthUser) {
    const now = this.clock.now();
    const orderId = await this.orderIdOf(unitId);

    await this.prisma.$transaction(async (tx) => {
      await this.lockOrder(tx, orderId, now);

      // The normal case: started -> done.
      let moved = await tx.prepUnit.updateMany({
        where: { id: unitId, status: "STARTED", ...ofConfirmedOrder },
        data: { status: "DONE", doneAt: now, version: { increment: 1 } },
      });
      // Finishing a unit that was never started is allowed, and records the start as well.
      if (moved.count === 0) {
        moved = await tx.prepUnit.updateMany({
          where: { id: unitId, status: "PENDING", ...ofConfirmedOrder },
          data: { status: "DONE", startedAt: now, doneAt: now, version: { increment: 1 } },
        });
        if (moved.count === 0) throw await this.whyNot(tx, unitId);
        await this.markOrderStarted(tx, orderId, now, actor, unitId);
      }
      await this.markOrderReadyIfAllDone(tx, orderId, now, actor);
    });
    return { unitId, status: "DONE" as const };
  }

  // ---------- admin: finish a whole order ----------

  async forceComplete(orderId: number, actor: AuthUser) {
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      await this.lockOrder(tx, orderId, now);
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) throw new DomainError("NOT_FOUND", "Order not found", 404);
      if (order.status !== "CONFIRMED") throw new DomainError("ORDER_NOT_CONFIRMED", "Only a confirmed order can be completed", 409);

      const inOrder = { combination: { line: { orderId } } };
      const wasStarted = await tx.prepUnit.updateMany({
        where: { ...inOrder, status: "STARTED" },
        data: { status: "DONE", doneAt: now, version: { increment: 1 } },
      });
      const wasPending = await tx.prepUnit.updateMany({
        where: { ...inOrder, status: "PENDING" },
        data: { status: "DONE", startedAt: now, doneAt: now, version: { increment: 1 } },
      });
      const unitsCompleted = wasStarted.count + wasPending.count;

      await tx.order.updateMany({ where: { id: orderId, kitchenStartedAt: null }, data: { kitchenStartedAt: now } });
      await tx.order.updateMany({ where: { id: orderId, kitchenReadyAt: null }, data: { kitchenReadyAt: now } });
      if (unitsCompleted > 0) await addEvent(tx, orderId, "FORCE_COMPLETED", actor.name, { unitsCompleted });
      return { orderId, unitsCompleted };
    });
  }

  // ---------- helpers ----------

  async orderIdOf(unitId: number): Promise<number> {
    const unit = await this.prisma.prepUnit.findUnique({ where: { id: unitId }, include: { combination: { include: { line: true } } } });
    if (!unit) throw new DomainError("NOT_FOUND", "Prep unit not found", 404);
    return unit.combination.line.orderId;
  }

  // Takes a row lock on the order until this transaction ends (by writing to it).
  private lockOrder(tx: Prisma.TransactionClient, orderId: number, now: Date) {
    return tx.order.updateMany({ where: { id: orderId }, data: { updatedAt: now } });
  }

  // The first unit to start sets the order's kitchen-started time, once.
  private async markOrderStarted(tx: Prisma.TransactionClient, orderId: number, now: Date, actor: AuthUser, unitId: number) {
    const first = await tx.order.updateMany({ where: { id: orderId, kitchenStartedAt: null }, data: { kitchenStartedAt: now } });
    if (first.count === 1) await addEvent(tx, orderId, "KITCHEN_STARTED", actor.name, { unitId });
  }

  // When no unit of the order is left unfinished, the order is kitchen-ready (once).
  private async markOrderReadyIfAllDone(tx: Prisma.TransactionClient, orderId: number, now: Date, actor: AuthUser) {
    const left = await tx.prepUnit.count({ where: { combination: { line: { orderId } }, status: { not: "DONE" } } });
    if (left > 0) return;
    const ready = await tx.order.updateMany({ where: { id: orderId, kitchenReadyAt: null }, data: { kitchenReadyAt: now } });
    if (ready.count === 1) await addEvent(tx, orderId, "KITCHEN_READY", actor.name);
  }

  // The guarded update matched nothing: say why, in words the cook understands.
  private async whyNot(tx: Prisma.TransactionClient, unitId: number): Promise<DomainError> {
    const unit = await tx.prepUnit.findUnique({ where: { id: unitId }, include: { combination: { include: { line: { include: { order: true } } } } } });
    if (!unit) return new DomainError("NOT_FOUND", "Prep unit not found", 404);
    if (unit.combination.line.order.status !== "CONFIRMED") {
      return new DomainError("ORDER_NOT_CONFIRMED", "Only units of confirmed orders can be worked on", 409);
    }
    if (unit.status === "DONE") return new DomainError("UNIT_ALREADY_DONE", "This unit is already finished", 409);
    return new DomainError("UNIT_ALREADY_STARTED", "This unit has already been started", 409);
  }
}
