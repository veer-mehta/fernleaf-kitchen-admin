import { Injectable } from "@nestjs/common";
import { OrderStatus, Prisma } from "@prisma/client";
import type { Paged } from "@fernleaf/shared";
import { fromDateString, toDateString } from "../common/dates";
import { DomainError } from "../common/domain-error";
import { PrismaService } from "../prisma/prisma.service";

const detailInclude = {
  company: true,
  employee: true,
  address: true,
  lines: {
    orderBy: { displayOrder: "asc" },
    include: { combinations: { orderBy: { displayOrder: "asc" } } },
  },
  events: { orderBy: [{ at: "asc" }, { id: "asc" }] },
} satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof detailInclude }>;

export function toOrderDetail(o: OrderRow) {
  return {
    id: o.id,
    status: o.status,
    rejectionReason: o.rejectionReason,
    company: { id: o.company.id, name: o.company.name },
    employee: { id: o.employee.id, name: o.employee.name, email: o.employee.email },
    deliveryDate: toDateString(o.deliveryDate),
    deliveryTime: o.deliveryTime,
    address: {
      id: o.address.id, label: o.address.label, line1: o.address.line1, line2: o.address.line2,
      city: o.address.city, postalCode: o.address.postalCode, instructions: o.address.instructions,
    },
    packaging: o.packaging,
    cutoffAt: o.cutoffAt,
    plannedDispatchReadyAt: o.plannedDispatchReadyAt,
    plannedKitchenReadyAt: o.plannedKitchenReadyAt,
    kitchenStartedAt: o.kitchenStartedAt,
    kitchenReadyAt: o.kitchenReadyAt,
    dispatchReadyAt: o.dispatchReadyAt,
    outForDeliveryAt: o.outForDeliveryAt,
    deliveredAt: o.deliveredAt,
    onTime: o.onTime,
    totalCents: o.totalCents,
    invoiceId: o.invoiceId,
    dropId: o.dropId,
    // The saved request (ids only), so the order builder can reopen a draft or placed order for editing.
    request: o.requestJson,
    lines: o.lines.map((l) => ({
      id: l.id,
      dishId: l.dishId,
      dishName: l.dishNameSnapshot,
      sku: l.skuSnapshot,
      station: l.stationNameSnapshot,
      quantity: l.quantity,
      lineTotalCents: l.combinations.reduce((sum, c) => sum + c.lineTotalCents, 0),
      combinations: l.combinations.map((c) => ({
        id: c.id,
        quantity: c.quantity,
        options: c.optionsSnapshot,
        unitPriceCents: c.unitPriceCents,
        lineTotalCents: c.lineTotalCents,
      })),
    })),
    timeline: o.events.map((e) => ({ type: e.type, actor: e.actor, at: e.at, meta: e.meta })),
  };
}

export interface OrderListFilters {
  page: number;
  pageSize: number;
  from?: string;
  to?: string;
  status?: OrderStatus;
  companyId?: number;
  invoiced?: "true" | "false";
  search?: string;
}

@Injectable()
export class OrdersQueryService {
  constructor(private readonly prisma: PrismaService) {}

  // A page of orders matching the filters, newest delivery date first. Filtering, searching
  // and paging all happen in the database, so the list stays fast however many orders exist.
  async list(f: OrderListFilters): Promise<Paged<unknown>> {
    const search = f.search?.trim();
    const where: Prisma.OrderWhereInput = {
      deliveryDate: f.from || f.to ? { gte: f.from ? fromDateString(f.from) : undefined, lte: f.to ? fromDateString(f.to) : undefined } : undefined,
      status: f.status,
      companyId: f.companyId,
      invoiceId: f.invoiced === "true" ? { not: null } : f.invoiced === "false" ? null : undefined,
      OR: search
        ? [
            ...(/^\d+$/.test(search) ? [{ id: Number(search) }] : []),
            { employee: { name: { contains: search, mode: "insensitive" as const } } },
            { employee: { email: { contains: search, mode: "insensitive" as const } } },
            { company: { name: { contains: search, mode: "insensitive" as const } } },
          ]
        : undefined,
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: [{ deliveryDate: "desc" }, { id: "desc" }],
        skip: (f.page - 1) * f.pageSize,
        take: f.pageSize,
        include: { company: true, employee: true, lines: { select: { quantity: true } } },
      }),
      this.prisma.order.count({ where }),
    ]);

    const items = rows.map((o) => ({
      id: o.id,
      status: o.status,
      deliveryDate: toDateString(o.deliveryDate),
      deliveryTime: o.deliveryTime,
      company: { id: o.company.id, name: o.company.name },
      employee: { id: o.employee.id, name: o.employee.name },
      totalCents: o.totalCents,
      invoiced: o.invoiceId !== null,
      itemCount: o.lines.reduce((sum, l) => sum + l.quantity, 0),
    }));
    return { items, total };
  }

  async detail(id: number) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: detailInclude });
    if (!order) throw new DomainError("NOT_FOUND", "Order not found", 404);
    return toOrderDetail(order);
  }
}
