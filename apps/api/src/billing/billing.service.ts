import { Injectable } from "@nestjs/common";
import { InvoiceStatus, Prisma } from "@prisma/client";
import type { Paged } from "@fernleaf/shared";
import { Clock } from "../common/clock";
import { toDateString } from "../common/dates";
import { DomainError } from "../common/domain-error";
import { PrismaService } from "../prisma/prisma.service";

// Every order the kitchen has confirmed (or delivered) is owed in full by its company.
const BILLABLE = ["CONFIRMED", "DELIVERED"] as const;

const invoiceInclude = {
  company: true,
  orders: { orderBy: { id: "asc" }, include: { employee: true } },
} satisfies Prisma.InvoiceInclude;

function toInvoice(i: Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>) {
  return {
    id: i.id,
    company: { id: i.company.id, name: i.company.name },
    status: i.status,
    totalCents: i.totalCents,
    createdAt: i.createdAt,
    paidAt: i.paidAt,
    orders: i.orders.map((o) => ({
      id: o.id,
      employeeName: o.employee.name,
      deliveryDate: toDateString(o.deliveryDate),
      deliveryTime: o.deliveryTime,
      status: o.status,
      totalCents: o.totalCents,
    })),
  };
}

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  // ---------- what still needs invoicing ----------

  async uninvoiced(companyId?: number) {
    const orders = await this.prisma.order.findMany({
      where: { invoiceId: null, status: { in: [...BILLABLE] }, companyId },
      include: { company: true, employee: true },
      orderBy: [{ deliveryDate: "asc" }, { id: "asc" }],
    });

    const groups = new Map<number, { companyId: number; companyName: string; orderCount: number; totalCents: number; orders: unknown[] }>();
    for (const o of orders) {
      const group = groups.get(o.companyId) ?? { companyId: o.companyId, companyName: o.company.name, orderCount: 0, totalCents: 0, orders: [] };
      group.orderCount += 1;
      group.totalCents += o.totalCents;
      group.orders.push({
        id: o.id,
        deliveryDate: toDateString(o.deliveryDate),
        deliveryTime: o.deliveryTime,
        employeeName: o.employee.name,
        status: o.status,
        totalCents: o.totalCents,
      });
      groups.set(o.companyId, group);
    }
    return { companies: [...groups.values()].sort((a, b) => a.companyName.localeCompare(b.companyName)) };
  }

  // ---------- creating an invoice ----------

  async create(input: { companyId: number; orderIds: number[] }) {
    if (!(await this.prisma.company.findUnique({ where: { id: input.companyId } }))) {
      throw new DomainError("INVALID_REFERENCE", "That company does not exist", 400, { companyId: "That company does not exist" });
    }

    // Check every chosen order first, so the message can say exactly what is wrong.
    const rows = await this.loadBillable(input.companyId, input.orderIds);
    const found = new Map(rows.map((o) => [o.id, o]));
    const problems = (message: string) => new DomainError("INVALID_REFERENCE", message, 400, { orderIds: message });

    const missing = input.orderIds.filter((id) => !found.has(id));
    if (missing.length > 0) throw problems(`Order(s) ${missing.join(", ")} do not exist`);
    const foreign = rows.filter((o) => o.companyId !== input.companyId);
    if (foreign.length > 0) throw problems(`Order(s) ${foreign.map((o) => o.id).join(", ")} belong to a different company`);
    const already = rows.filter((o) => o.invoiceId !== null);
    if (already.length > 0) throw new DomainError("ORDER_ALREADY_INVOICED", `Order(s) ${already.map((o) => o.id).join(", ")} are already on an invoice`, 409);
    const notBillable = rows.filter((o) => !BILLABLE.includes(o.status as (typeof BILLABLE)[number]));
    if (notBillable.length > 0) {
      throw new DomainError("ORDER_NOT_BILLABLE", `Order(s) ${notBillable.map((o) => o.id).join(", ")} are not confirmed, so they cannot be invoiced`, 409);
    }

    // The total is added up here from the stored order totals, never taken from the client.
    const totalCents = rows.reduce((sum, o) => sum + o.totalCents, 0);

    const invoiceId = await this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.create({ data: { companyId: input.companyId, totalCents } });
      // The guard: claim exactly these orders, and only if each is still uninvoiced and billable.
      // If someone else invoiced one of them a moment ago, fewer rows match and everything
      // (including the invoice just created) is rolled back. That is what keeps "one invoice
      // per order" true even when two people invoice at the same instant.
      const claimed = await tx.order.updateMany({
        where: { id: { in: input.orderIds }, companyId: input.companyId, invoiceId: null, status: { in: [...BILLABLE] } },
        data: { invoiceId: invoice.id },
      });
      if (claimed.count !== input.orderIds.length) {
        throw new DomainError("ORDER_ALREADY_INVOICED", "One of these orders was invoiced by someone else just now. Reload and try again.", 409);
      }
      return invoice.id;
    });
    return this.detail(invoiceId);
  }

  // The orders as they are right now (used for the checks above).
  async loadBillable(companyId: number, orderIds: number[]) {
    void companyId; // orders are loaded by id; the company check happens on the rows afterwards
    return this.prisma.order.findMany({ where: { id: { in: orderIds } } });
  }

  // ---------- reading ----------

  async list(q: { page: number; pageSize: number; companyId?: number; status?: InvoiceStatus }): Promise<Paged<unknown>> {
    const where: Prisma.InvoiceWhereInput = { companyId: q.companyId, status: q.status };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { company: true, _count: { select: { orders: true } } },
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return {
      total,
      items: rows.map((i) => ({
        id: i.id,
        company: { id: i.company.id, name: i.company.name },
        status: i.status,
        totalCents: i.totalCents,
        orderCount: i._count.orders,
        createdAt: i.createdAt,
        paidAt: i.paidAt,
      })),
    };
  }

  async detail(id: number) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id }, include: invoiceInclude });
    if (!invoice) throw new DomainError("NOT_FOUND", "Invoice not found", 404);
    return toInvoice(invoice);
  }

  // ---------- paying and voiding ----------

  async pay(id: number) {
    await this.detail(id); // 404 if unknown
    const moved = await this.prisma.invoice.updateMany({ where: { id, status: "OPEN" }, data: { status: "PAID", paidAt: this.clock.now() } });
    if (moved.count === 0) throw this.notOpen();
    return this.detail(id);
  }

  // Only an unpaid invoice can be voided. Its orders are released so they can be changed or invoiced again.
  async void(id: number) {
    await this.detail(id);
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.invoice.updateMany({ where: { id, status: "OPEN" }, data: { status: "VOID" } });
      if (moved.count === 0) throw this.notOpen();
      await tx.order.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } });
    });
    return this.detail(id);
  }

  private notOpen() {
    return new DomainError("INVOICE_NOT_OPEN", "Only an open invoice can be paid or voided", 409);
  }
}
