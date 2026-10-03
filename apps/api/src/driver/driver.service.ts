import { Injectable } from "@nestjs/common";
import { kitchenToday } from "@fernleaf/shared";
import { AuthUser } from "../auth/auth-user";
import { Clock } from "../common/clock";
import { fromDateString } from "../common/dates";
import { DomainError } from "../common/domain-error";
import { DispatchService } from "../dispatch/dispatch.service";
import { CutoffProcessor } from "../orders/cutoff-processor.service";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.service";

// The driver's own view. Every query here is filtered by the logged-in driver's id, taken from the
// session on the server. There is no way for a driver to ask for someone else's drops.
@Injectable()
export class DriverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
    private readonly cutoff: CutoffProcessor,
    private readonly dispatch: DispatchService,
  ) {}

  private async today(): Promise<string> {
    const { timezone } = await this.settings.getKitchenSettings();
    return kitchenToday(this.clock.now(), timezone);
  }

  async list(user: AuthUser) {
    await this.cutoff.processDueDates();
    const date = await this.today();
    const drops = await this.prisma.drop.findMany({
      where: { driverId: user.id, deliveryDate: fromDateString(date), orders: { some: { status: { in: ["CONFIRMED", "DELIVERED"] } } } },
      include: {
        company: true,
        address: true,
        orders: { where: { status: { in: ["CONFIRMED", "DELIVERED"] } }, orderBy: { id: "asc" }, include: { employee: true, lines: { select: { quantity: true } } } },
      },
      orderBy: [{ deliveryTime: "asc" }, { id: "asc" }],
    });

    return {
      date,
      drops: drops.map((d) => ({
        id: d.id,
        deliveryTime: d.deliveryTime,
        status: d.status,
        company: { id: d.company.id, name: d.company.name },
        instructions: d.company.driverInstructions,
        address: {
          label: d.address.label, line1: d.address.line1, line2: d.address.line2, city: d.address.city,
          postalCode: d.address.postalCode, instructions: d.address.instructions,
        },
        orders: d.orders.map((o) => ({
          id: o.id,
          employeeName: o.employee.name,
          itemCount: o.lines.reduce((sum, l) => sum + l.quantity, 0),
        })),
        note: d.note,
        photoUrl: d.photoUrl,
        deliveredAt: d.deliveredAt,
      })),
    };
  }

  async deliver(user: AuthUser, dropId: number, input: { note?: string; photoUrl?: string }) {
    // Not the driver's drop, or not today's? It "does not exist" as far as they can tell.
    const date = await this.today();
    const own = await this.prisma.drop.findFirst({ where: { id: dropId, driverId: user.id, deliveryDate: fromDateString(date) } });
    if (!own) throw new DomainError("NOT_FOUND", "Drop not found", 404);
    return this.dispatch.advance(dropId, "delivered", user, input);
  }
}
