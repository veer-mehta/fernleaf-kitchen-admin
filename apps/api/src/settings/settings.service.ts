import { Injectable } from "@nestjs/common";
import { KitchenSettings, kitchenToday } from "@fernleaf/shared";
import { Clock } from "../common/clock";
import { fromDateString, toDateString } from "../common/dates";
import { DomainError } from "../common/domain-error";
import { isRecordNotFound, isUniqueViolation } from "../common/prisma-errors";
import { PrismaService } from "../prisma/prisma.service";
import { loadKitchenSettings } from "./load-settings";

type SettingsChange = Partial<Omit<KitchenSettings, "holidays">>;

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  // Saved values override the defaults in code; holidays come from their own table.
  getKitchenSettings(): Promise<KitchenSettings> {
    return loadKitchenSettings(this.prisma);
  }

  async update(change: SettingsChange): Promise<KitchenSettings> {
    // Only the keys that were sent are written; each is one row.
    const writes = Object.entries(change)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) =>
        this.prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } }),
      );
    await this.prisma.$transaction(writes);
    return this.getKitchenSettings();
  }

  // Today's date in the kitchen zone ("2026-10-03"), whatever zone the server runs in.
  async today(): Promise<string> {
    return kitchenToday(this.clock.now(), (await this.getKitchenSettings()).timezone);
  }

  async listHolidays() {
    const holidays = await this.prisma.kitchenHoliday.findMany({ orderBy: { date: "asc" } });
    return holidays.map((h) => ({ id: h.id, date: toDateString(h.date), name: h.name }));
  }

  async addHoliday(date: string, name: string) {
    try {
      const h = await this.prisma.kitchenHoliday.create({ data: { date: fromDateString(date), name } });
      return { id: h.id, date: toDateString(h.date), name: h.name };
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new DomainError("HOLIDAY_EXISTS", "That date is already a holiday", 409, {
          date: "That date is already a holiday",
        });
      }
      throw e;
    }
  }

  async removeHoliday(id: number) {
    try {
      await this.prisma.kitchenHoliday.delete({ where: { id } });
      return { ok: true };
    } catch (e) {
      if (isRecordNotFound(e)) throw new DomainError("NOT_FOUND", "Holiday not found", 404);
      throw e;
    }
  }
}
