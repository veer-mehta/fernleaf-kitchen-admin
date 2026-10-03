import { Injectable } from "@nestjs/common";
import { DateTime } from "luxon";
import type { OrderInputType } from "@fernleaf/shared";
import { toDateString } from "../common/dates";
import { DomainError } from "../common/domain-error";
import { MenuService } from "../menu/menu.service";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.service";
import { validateLine, type GroupRule } from "./combinations";
import { computeCutoff } from "./cutoff";
import { lineTotal, orderTotal, priceCombination } from "./order-pricing";
import { plannedTimes } from "./planned-times";

export interface BuiltCombination {
  quantity: number;
  optionsSnapshot: { groupName: string; optionName: string; portion: string | null; priceCents: number }[];
  unitPriceCents: number;
  lineTotalCents: number;
}
export interface BuiltLine {
  dishId: number;
  dishName: string;
  sku: string;
  stationId: number | null;
  stationName: string | null;
  quantity: number;
  combinations: BuiltCombination[];
}
export interface BuiltOrder {
  employeeId: number;
  companyId: number;
  deliveryDate: string;
  deliveryTime: string;
  addressId: number;
  packaging: "STANDARD" | "ECO" | "INSULATED";
  cutoffAt: Date;
  plannedDispatchReadyAt: Date;
  plannedKitchenReadyAt: Date;
  lines: BuiltLine[];
  totalCents: number;
  warnings: string[];
}

const WEEKDAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// Turns what the client sent into a fully checked and priced order, WITHOUT saving anything.
// Every rule about what may be ordered lives here, on the server. Prices are never taken from
// the client: they are looked up from the employee's menu, which applies the price tier.
@Injectable()
export class OrderBuilder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly menu: MenuService,
    private readonly settings: SettingsService,
  ) {}

  async build(input: OrderInputType, now: Date): Promise<BuiltOrder> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: input.employeeId },
      include: {
        company: { include: { addresses: { orderBy: { id: "asc" } }, holidays: true } },
        allergens: { include: { allergen: true } },
        dietaryTags: { include: { dietaryTag: true } },
      },
    });
    if (!employee) {
      throw new DomainError("INVALID_REFERENCE", "That employee does not exist", 400, { employeeId: "That employee does not exist" });
    }
    if (!employee.active) {
      throw new DomainError("EMPLOYEE_INACTIVE", "That employee is inactive", 400, { employeeId: "That employee is inactive" });
    }
    const company = employee.company;

    // 1. Cut-off. Checked first: a locked date rejects everything, whatever else is in the request.
    const settings = await this.settings.getKitchenSettings();
    const cutoffAt = computeCutoff(input.deliveryDate, settings);
    if (now.getTime() >= cutoffAt.getTime()) {
      throw new DomainError("CUTOFF_PASSED", `Orders for ${input.deliveryDate} are closed (the cut-off has passed)`, 409);
    }

    const fields: Record<string, string> = {};

    // 2. The company must be able to receive a delivery that day (its own calendar, not the kitchen's).
    const weekday = DateTime.fromISO(input.deliveryDate, { zone: "utc" }).weekday; // a plain date has the same weekday everywhere
    const holiday = company.holidays.find((h) => toDateString(h.date) === input.deliveryDate);
    if (!company.workingDays.includes(weekday)) {
      fields.deliveryDate = `${company.name} does not receive deliveries on ${WEEKDAYS[weekday]}s`;
    } else if (holiday) {
      fields.deliveryDate = `${company.name} is closed on ${input.deliveryDate}${holiday.name ? ` (${holiday.name})` : ""}`;
    }

    // 3. Delivery details. Employees can only differ from the company defaults if they are allowed to.
    const defaultAddress = company.addresses[0];
    if (!defaultAddress) {
      throw new DomainError("NO_ADDRESS", "The company has no delivery address", 400, { addressId: "The company has no delivery address" });
    }
    let addressId = defaultAddress.id;
    if (input.addressId !== undefined) {
      if (!company.addresses.some((a) => a.id === input.addressId)) {
        fields.addressId = "That address does not belong to the employee's company";
      } else {
        addressId = input.addressId;
        if (addressId !== defaultAddress.id && !employee.canChooseAddress) {
          fields.addressId = "This employee may not choose a different delivery address";
        }
      }
    }
    const deliveryTime = input.deliveryTime ?? company.deliveryTime;
    if (deliveryTime !== company.deliveryTime && !employee.canChangeTime) {
      fields.deliveryTime = "This employee may not change the delivery time";
    }
    const packaging = input.packaging ?? company.defaultPackaging;
    if (packaging !== company.defaultPackaging && !employee.canChangePackaging) {
      fields.packaging = "This employee may not change the packaging";
    }

    // 4. Dishes, choices and prices.
    const employeeAllergens = new Set(employee.allergens.map((a) => a.allergen.name));
    const employeeDiets = employee.dietaryTags.map((t) => t.dietaryTag.name);
    const warnings = new Set<string>();
    const lines: BuiltLine[] = [];

    for (const [i, line] of input.lines.entries()) {
      // The same lookup the menu preview uses: unpriced, hidden or inactive dishes are not found.
      const dish = await this.menu.findDishForEmployee(employee.id, line.dishId);
      if (!dish) {
        fields[`lines.${i}.dishId`] = "This dish is not on the employee's menu";
        continue;
      }
      const groups: GroupRule[] = dish.groups.map((g) => ({
        groupId: g.groupId,
        name: g.name,
        required: g.required,
        optionIds: g.options.map((o) => o.optionId),
        portionSizeIds: g.portions.map((p) => p.portionSizeId),
      }));

      try {
        validateLine(line.quantity, dish.minOrderQty, line.combinations, groups, `lines.${i}.`);
      } catch (e) {
        if (e instanceof DomainError && e.fields) {
          Object.assign(fields, e.fields);
          continue;
        }
        throw e;
      }

      const stationDish = await this.prisma.dish.findUniqueOrThrow({ where: { id: dish.dishId }, include: { station: true } });
      const built: BuiltCombination[] = line.combinations.map((combo) => {
        const picks: { optionCents: number; portionExtraCents: number }[] = [];
        const optionsSnapshot: BuiltCombination["optionsSnapshot"] = [];
        // Walk the dish's groups in display order so snapshots always list choices in the same order.
        for (const group of dish.groups) {
          const selection = combo.selections.find((s) => s.groupId === group.groupId);
          if (!selection) continue;
          const option = group.options.find((o) => o.optionId === selection.optionId)!;
          // The chosen size (if the group is sold in sizes) adds its own charge on top of the option's price.
          const size = group.portions.find((p) => p.portionSizeId === selection.portionSizeId);
          picks.push({ optionCents: option.priceCents, portionExtraCents: size?.extraCents ?? 0 });
          optionsSnapshot.push({ groupName: group.name, optionName: option.name, portion: size?.name ?? null, priceCents: option.priceCents + (size?.extraCents ?? 0) });
          option.allergens.filter((a) => employeeAllergens.has(a)).forEach((a) => warnings.add(`${option.name} contains ${a}, which ${employee.name} is allergic to`));
        }
        const unit = priceCombination(dish.priceCents, picks);
        return { quantity: combo.quantity, optionsSnapshot, unitPriceCents: unit, lineTotalCents: lineTotal(unit, combo.quantity) };
      });

      dish.allergens.filter((a) => employeeAllergens.has(a)).forEach((a) => warnings.add(`${dish.name} contains ${a}, which ${employee.name} is allergic to`));
      employeeDiets.filter((d) => !dish.dietaryTags.includes(d)).forEach((d) => warnings.add(`${dish.name} is not marked ${d}, which ${employee.name} prefers`));

      lines.push({
        dishId: dish.dishId,
        dishName: dish.name,
        sku: dish.sku,
        stationId: stationDish.station?.id ?? null,
        stationName: stationDish.station?.name ?? null,
        quantity: line.quantity,
        combinations: built,
      });
    }

    if (Object.keys(fields).length > 0) {
      throw new DomainError("INVALID_ORDER", "The order has problems. Check the highlighted fields.", 400, fields);
    }

    const planned = plannedTimes(input.deliveryDate, deliveryTime, company.deliveryMinutes, settings.kitchenReadyBufferMinutes, settings.timezone);
    return {
      employeeId: employee.id,
      companyId: company.id,
      deliveryDate: input.deliveryDate,
      deliveryTime,
      addressId,
      packaging,
      cutoffAt,
      plannedDispatchReadyAt: planned.dispatchReadyAt,
      plannedKitchenReadyAt: planned.kitchenReadyAt,
      lines,
      totalCents: orderTotal(lines.flatMap((l) => l.combinations.map((c) => c.lineTotalCents))),
      warnings: [...warnings],
    };
  }
}

