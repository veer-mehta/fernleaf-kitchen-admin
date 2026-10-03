import { Injectable } from "@nestjs/common";
import { DropStatus, Prisma } from "@prisma/client";
import { DateTime } from "luxon";
import { kitchenToday, PERMISSIONS } from "@fernleaf/shared";
import { AuthUser } from "../auth/auth-user";
import { Clock } from "../common/clock";
import { fromDateString, toDateString } from "../common/dates";
import { DomainError } from "../common/domain-error";
import { CutoffProcessor } from "../orders/cutoff-processor.service";
import { addEvent } from "../orders/order-events";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.service";
import { assertTransition, stageOf, type Stage } from "./dispatch-transitions";

export type Step = "dispatch-ready" | "out-for-delivery" | "delivered";

// What each step does to the drop and to the orders inside it.
const STEPS: Record<Step, { dropFrom: DropStatus; dropTo: DropStatus; orderFrom: Stage; orderTo: Stage; event: string }> = {
  "dispatch-ready": { dropFrom: "OPEN", dropTo: "DISPATCH_READY", orderFrom: "KITCHEN_READY", orderTo: "DISPATCH_READY", event: "DISPATCH_READY" },
  "out-for-delivery": { dropFrom: "DISPATCH_READY", dropTo: "OUT_FOR_DELIVERY", orderFrom: "DISPATCH_READY", orderTo: "OUT_FOR_DELIVERY", event: "OUT_FOR_DELIVERY" },
  delivered: { dropFrom: "OUT_FOR_DELIVERY", dropTo: "DELIVERED", orderFrom: "OUT_FOR_DELIVERY", orderTo: "DELIVERED", event: "DELIVERED" },
};

// A drop only matters while it holds at least one live (confirmed or delivered) order.
const liveOrders = { status: { in: ["CONFIRMED", "DELIVERED"] as ("CONFIRMED" | "DELIVERED")[] } };

@Injectable()
export class DispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
    private readonly cutoff: CutoffProcessor,
  ) {}

  // ---------- the board ----------

  async board(query: { date?: string }) {
    await this.cutoff.processDueDates(); // safety net if the background job has not run
    const now = this.clock.now();
    const { timezone } = await this.settings.getKitchenSettings();
    const date = query.date ?? kitchenToday(now, timezone);

    const drops = await this.prisma.drop.findMany({
      where: { deliveryDate: fromDateString(date), orders: { some: liveOrders } },
      include: {
        company: true,
        address: true,
        driver: true,
        orders: { where: liveOrders, orderBy: { id: "asc" }, include: { employee: true, lines: { select: { quantity: true } } } },
      },
      orderBy: [{ deliveryTime: "asc" }, { id: "asc" }],
    });

    const rows = drops.map((d) => {
      const orders = d.orders.map((o) => ({
        id: o.id,
        employeeName: o.employee.name,
        itemCount: o.lines.reduce((sum, l) => sum + l.quantity, 0),
        stage: stageOf(o) as Stage,
        plannedDispatchReadyAt: o.plannedDispatchReadyAt,
      }));
      const cooking = orders.filter((o) => o.stage === "COOKING").length;
      const late = d.status !== "DELIVERED" && now.getTime() > this.deliveryInstant(d.deliveryDate, d.deliveryTime, timezone).getTime();

      let nextAction: Step | null = null;
      let blocker: string | null = null;
      if (d.status === "OPEN") {
        if (cooking > 0) blocker = `${cooking} of ${orders.length} order(s) still cooking`;
        else nextAction = "dispatch-ready";
      } else if (d.status === "DISPATCH_READY") {
        nextAction = "out-for-delivery";
        if (!d.driverId) blocker = "Assign a driver first";
      } else if (d.status === "OUT_FOR_DELIVERY") {
        nextAction = "delivered";
      }

      return {
        id: d.id,
        deliveryTime: d.deliveryTime,
        status: d.status,
        company: { id: d.company.id, name: d.company.name },
        address: { id: d.address.id, label: d.address.label, line1: d.address.line1, city: d.address.city },
        driver: d.driver ? { id: d.driver.id, name: d.driver.name } : null,
        orders,
        late,
        nextAction,
        blocker,
        note: d.note,
        photoUrl: d.photoUrl,
        deliveredAt: d.deliveredAt,
      };
    });

    const count = (status: DropStatus) => rows.filter((r) => r.status === status).length;
    const totals = {
      open: count("OPEN"),
      dispatchReady: count("DISPATCH_READY"),
      outForDelivery: count("OUT_FOR_DELIVERY"),
      delivered: count("DELIVERED"),
      unassigned: rows.filter((r) => r.status !== "DELIVERED" && !r.driver).length,
      late: rows.filter((r) => r.late).length,
    };
    return { date, drops: rows, totals };
  }

  // ---------- assigning a driver ----------

  async assignDriver(dropId: number, driverId: number | null) {
    const drop = await this.dropOrThrow(dropId);
    if (drop.status === "DELIVERED") throw new DomainError("DROP_DELIVERED", "This drop has already been delivered", 409);

    if (driverId !== null) {
      // Anyone whose role holds the driver permission can drive; no role names are checked.
      const driver = await this.prisma.staff.findFirst({
        where: { id: driverId, active: true, role: { permissions: { some: { permission: { code: PERMISSIONS.DRIVER_OWN_DROPS } } } } },
      });
      if (!driver) {
        throw new DomainError("INVALID_REFERENCE", "That person is not an active driver", 400, { driverId: "That person is not an active driver" });
      }
    }
    await this.prisma.drop.update({ where: { id: dropId }, data: { driverId } });
    return { id: dropId, driverId };
  }

  // ---------- moving a drop through its stages ----------
  //
  // Everything for one step happens in one transaction. The drop's status is changed FIRST with
  // the expected old status in the WHERE clause: if two people press the button at once, only one
  // matches and the other gets a 409. Then every live order in the drop must be at the right stage,
  // and all of them are moved together. Any failure undoes the whole step.

  async advance(dropId: number, step: Step, actor: AuthUser, delivery?: { note?: string; photoUrl?: string }) {
    const cfg = STEPS[step];
    const now = this.clock.now();
    const drop = await this.dropOrThrow(dropId);
    const { timezone, onTimeGraceMinutes } = await this.settings.getKitchenSettings();

    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.drop.updateMany({
        where: { id: dropId, status: cfg.dropFrom },
        data: {
          status: cfg.dropTo,
          ...(step === "delivered" ? { deliveredAt: now, note: delivery?.note ?? null, photoUrl: delivery?.photoUrl ?? null } : {}),
        },
      });
      if (moved.count === 0) {
        const current = await tx.drop.findUniqueOrThrow({ where: { id: dropId } });
        throw new DomainError("INVALID_TRANSITION", `This drop is ${current.status.toLowerCase().replace(/_/g, " ")}; it cannot go to "${step.replace(/-/g, " ")}" now`, 409);
      }

      const orders = await tx.order.findMany({ where: { dropId, status: "CONFIRMED" } });
      if (orders.length === 0) throw new DomainError("EMPTY_DROP", "This drop has no live orders", 409);

      // Every order must be exactly one step behind. A cooking order gives ORDERS_NOT_READY.
      for (const order of orders) {
        const stage = stageOf(order)!;
        if (stage !== cfg.orderFrom) assertTransition(stage, cfg.orderTo);
      }
      if (step === "out-for-delivery" && !drop.driverId) {
        throw new DomainError("DRIVER_REQUIRED", "Assign a driver before sending this drop out", 409);
      }

      const result = await this.moveOrders(tx, dropId, step, now, {
        onTime: now.getTime() <= this.deliveryInstant(drop.deliveryDate, drop.deliveryTime, timezone).getTime() + onTimeGraceMinutes * 60_000,
      });
      if (result.count !== orders.length) {
        throw new DomainError("ORDER_CHANGED", "An order in this drop changed while it was being updated. Reload and try again.", 409);
      }
      for (const order of orders) await addEvent(tx, order.id, cfg.event, actor.name, step === "delivered" && delivery?.note ? { note: delivery.note } : undefined);
    });
    return { id: dropId, status: cfg.dropTo };
  }

  private moveOrders(tx: Prisma.TransactionClient, dropId: number, step: Step, now: Date, flags: { onTime: boolean }) {
    const base = { dropId, status: "CONFIRMED" as const };
    if (step === "dispatch-ready") {
      return tx.order.updateMany({ where: { ...base, kitchenReadyAt: { not: null }, dispatchReadyAt: null }, data: { dispatchReadyAt: now } });
    }
    if (step === "out-for-delivery") {
      return tx.order.updateMany({ where: { ...base, dispatchReadyAt: { not: null }, outForDeliveryAt: null }, data: { outForDeliveryAt: now } });
    }
    return tx.order.updateMany({
      where: { ...base, outForDeliveryAt: { not: null } },
      data: { status: "DELIVERED", deliveredAt: now, onTime: flags.onTime },
    });
  }

  async dropOrThrow(dropId: number) {
    const drop = await this.prisma.drop.findUnique({ where: { id: dropId } });
    if (!drop) throw new DomainError("NOT_FOUND", "Drop not found", 404);
    return drop;
  }

  // The exact moment a drop is due, from its plain date + "HH:mm" in the kitchen zone.
  private deliveryInstant(deliveryDate: Date, deliveryTime: string, timezone: string): Date {
    return DateTime.fromISO(`${toDateString(deliveryDate)}T${deliveryTime}`, { zone: timezone }).toJSDate();
  }
}
