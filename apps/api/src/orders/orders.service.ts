import { Injectable } from "@nestjs/common";
import { OrderStatus, Prisma } from "@prisma/client";
import { OrderInput, PERMISSIONS, type OrderInputType } from "@fernleaf/shared";
import { AuthUser } from "../auth/auth-user";
import { Clock } from "../common/clock";
import { fromDateString, toDateString } from "../common/dates";
import { DomainError } from "../common/domain-error";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.service";
import { deleteDropIfEmpty, findOrCreateDrop } from "./drops";
import { addEvent } from "./order-events";
import { BuiltOrder, OrderBuilder } from "./order-builder";
import { assertEditable } from "./order-lock";
import { OrdersQueryService } from "./orders-query.service";
import { plannedTimes } from "./planned-times";

const canOverride = (user: AuthUser) => user.permissions.includes(PERMISSIONS.ORDERS_OVERRIDE);

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly builder: OrderBuilder,
    private readonly query: OrdersQueryService,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
  ) {}

  // ---------- create ----------

  async create(input: OrderInputType, actor: AuthUser) {
    const built = await this.builder.build(input, this.clock.now());
    const orderId = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({ data: this.orderData(built, input, input.status) });
      await this.createLines(tx, order.id, built);
      await addEvent(tx, order.id, "CREATED", actor.name);
      if (input.status === "PLACED") await addEvent(tx, order.id, "PLACED", actor.name);
      return order.id;
    });
    return { ...(await this.query.detail(orderId)), warnings: built.warnings };
  }

  // ---------- edit the dishes / details of a draft or placed order ----------

  async update(id: number, input: OrderInputType, actor: AuthUser) {
    const order = await this.load(id);
    assertEditable(order, "edit", this.clock.now(), canOverride(actor));
    if (input.employeeId !== order.employeeId) {
      throw new DomainError("EMPLOYEE_CANNOT_CHANGE", "An order cannot be moved to another employee", 400, {
        employeeId: "An order cannot be moved to another employee",
      });
    }
    if (order.status === "PLACED" && input.status === "DRAFT") {
      throw new DomainError("INVALID_TRANSITION", "A placed order cannot go back to a draft", 409);
    }
    return this.rewrite(order, input, actor, "EDITED");
  }

  // ---------- place a draft ----------

  async place(id: number, actor: AuthUser) {
    const order = await this.load(id);
    if (order.status !== "DRAFT") {
      throw new DomainError("ORDER_NOT_DRAFT", `This order is already ${order.status.toLowerCase()}`, 409);
    }
    assertEditable(order, "edit", this.clock.now(), canOverride(actor));
    // Re-check and re-price from the saved request: the draft may be days old, and prices or
    // the menu may have changed since. What gets placed is what is true NOW.
    const input = OrderInput.parse({ ...(order.requestJson as object), status: "PLACED" });
    return this.rewrite(order, input, actor, null);
  }

  // Replaces an order's contents with a freshly built version. The status guard in the
  // updateMany means that if two people act on the same order at once, only one succeeds.
  private async rewrite(order: { id: number; status: OrderStatus }, input: OrderInputType, actor: AuthUser, edited: "EDITED" | null) {
    const built = await this.builder.build(input, this.clock.now());
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.order.updateMany({
        where: { id: order.id, status: order.status },
        data: this.orderData(built, input, input.status),
      });
      if (changed.count === 0) throw new DomainError("ORDER_CHANGED", "Someone else just changed this order. Reload and try again.", 409);

      await tx.orderLine.deleteMany({ where: { orderId: order.id } });
      await this.createLines(tx, order.id, built);
      if (edited) await addEvent(tx, order.id, edited, actor.name);
      if (order.status === "DRAFT" && input.status === "PLACED") await addEvent(tx, order.id, "PLACED", actor.name);
    });
    return { ...(await this.query.detail(order.id)), warnings: built.warnings };
  }

  // ---------- cancel / reject ----------

  async cancel(id: number, reason: string | undefined, actor: AuthUser) {
    const order = await this.load(id);
    assertEditable(order, "cancel", this.clock.now(), canOverride(actor));
    await this.prisma.$transaction(async (tx) => {
      // Only moves the order if it is still in the status we just checked.
      const changed = await tx.order.updateMany({ where: { id, status: order.status, invoiceId: null }, data: { status: "CANCELLED" } });
      if (changed.count === 0) throw new DomainError("ORDER_CHANGED", "Someone else just changed this order. Reload and try again.", 409);
      await addEvent(tx, id, "CANCELLED", actor.name, reason ? { reason } : undefined);
    });
    // A cancelled order's prep units drop off the kitchen board because the board shows confirmed orders only.
    return this.query.detail(id);
  }

  async reject(id: number, reason: string, actor: AuthUser) {
    await this.load(id);
    await this.prisma.$transaction(async (tx) => {
      // Rejecting is only possible while the order is still waiting (PLACED), before confirmation.
      const changed = await tx.order.updateMany({
        where: { id, status: "PLACED", invoiceId: null },
        data: { status: "REJECTED", rejectionReason: reason },
      });
      if (changed.count === 0) throw new DomainError("ORDER_NOT_PLACED", "Only a placed order that is not yet confirmed can be rejected", 409);
      await addEvent(tx, id, "REJECTED", actor.name, { reason });
    });
    return this.query.detail(id);
  }

  // ---------- admin override of delivery details ----------

  async override(id: number, change: { deliveryTime?: string; addressId?: number; packaging?: "STANDARD" | "ECO" | "INSULATED" }, actor: AuthUser) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: { company: { include: { addresses: true } } } });
    if (!order) throw new DomainError("NOT_FOUND", "Order not found", 404);
    assertEditable(order, "override", this.clock.now(), canOverride(actor));

    if (change.addressId !== undefined && !order.company.addresses.some((a) => a.id === change.addressId)) {
      throw new DomainError("INVALID_REFERENCE", "That address does not belong to the order's company", 400, {
        addressId: "That address does not belong to the order's company",
      });
    }
    const deliveryTime = change.deliveryTime ?? order.deliveryTime;
    const addressId = change.addressId ?? order.addressId;
    const packaging = change.packaging ?? order.packaging;

    // The plan is worked out again from the new delivery time.
    const settings = await this.settings.getKitchenSettings();
    const planned = plannedTimes(toDateString(order.deliveryDate), deliveryTime, order.company.deliveryMinutes, settings.kitchenReadyBufferMinutes, settings.timezone);

    await this.prisma.$transaction(async (tx) => {
      let dropId = order.dropId;
      // A confirmed order sits in a drop; a new time or address may mean a different drop.
      if (order.status === "CONFIRMED") {
        const drop = await findOrCreateDrop(tx, { companyId: order.companyId, addressId, deliveryDate: toDateString(order.deliveryDate), deliveryTime });
        dropId = drop.id;
      }
      const changed = await tx.order.updateMany({
        where: { id, status: order.status, invoiceId: null },
        data: { deliveryTime, addressId, packaging, dropId, plannedDispatchReadyAt: planned.dispatchReadyAt, plannedKitchenReadyAt: planned.kitchenReadyAt },
      });
      if (changed.count === 0) throw new DomainError("ORDER_CHANGED", "Someone else just changed this order. Reload and try again.", 409);
      if (order.dropId !== dropId) await deleteDropIfEmpty(tx, order.dropId);
      await addEvent(tx, id, "OVERRIDDEN", actor.name, {
        from: { deliveryTime: order.deliveryTime, addressId: order.addressId, packaging: order.packaging },
        to: { deliveryTime, addressId, packaging },
      });
    });
    return this.query.detail(id);
  }

  // ---------- helpers ----------

  private async load(id: number) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new DomainError("NOT_FOUND", "Order not found", 404);
    return order;
  }

  // The columns of an Order row for a built order (everything except its lines).
  private orderData(built: BuiltOrder, input: OrderInputType, status: "DRAFT" | "PLACED") {
    return {
      companyId: built.companyId,
      employeeId: built.employeeId,
      deliveryDate: fromDateString(built.deliveryDate),
      deliveryTime: built.deliveryTime,
      addressId: built.addressId,
      packaging: built.packaging,
      status,
      cutoffAt: built.cutoffAt,
      plannedDispatchReadyAt: built.plannedDispatchReadyAt,
      plannedKitchenReadyAt: built.plannedKitchenReadyAt,
      totalCents: built.totalCents,
      requestJson: input as Prisma.InputJsonValue,
    };
  }

  // Writes the lines and combinations with their snapshots (names and prices as they are today).
  private async createLines(tx: Prisma.TransactionClient, orderId: number, built: BuiltOrder) {
    for (const [i, line] of built.lines.entries()) {
      await tx.orderLine.create({
        data: {
          orderId,
          dishId: line.dishId,
          dishNameSnapshot: line.dishName,
          skuSnapshot: line.sku,
          stationIdSnapshot: line.stationId,
          stationNameSnapshot: line.stationName,
          quantity: line.quantity,
          displayOrder: i,
          combinations: {
            create: line.combinations.map((c, j) => ({
              quantity: c.quantity,
              optionsSnapshot: c.optionsSnapshot,
              unitPriceCents: c.unitPriceCents,
              lineTotalCents: c.lineTotalCents,
              displayOrder: j,
            })),
          },
        },
      });
    }
  }
}
