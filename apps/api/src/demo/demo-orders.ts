import { Order, OrderStatus, Prisma, PrismaClient, UnitStatus } from "@prisma/client";
import { DateTime } from "luxon";
import { kitchenToday } from "@fernleaf/shared";
import { fromDateString, toDateString } from "../common/dates";
import { computeCutoff } from "../orders/cutoff";
import { findOrCreateDrop } from "../orders/drops";
import { lineTotal, orderTotal, priceCombination } from "../orders/order-pricing";
import { plannedTimes } from "../orders/planned-times";
import { loadKitchenSettings } from "../settings/load-settings";
import { COMPANIES } from "./demo-data";

// ---------------------------------------------------------------------------------------------
// Demo orders. Everything is worked out relative to "today" in the kitchen zone, never a fixed
// date, so whenever this runs the review day has orders: confirmed ones with food in every state
// of preparation, drops at several times for the driver, history behind it and orders ahead.
// ---------------------------------------------------------------------------------------------

const FIRST_OFFSET = -6; // six days of history ...
const LAST_OFFSET = 7; // ... and a week ahead

export interface DemoSummary {
  today: string;
  orders: number;
  byStatus: Record<string, number>;
  drops: number;
  invoices: number;
}

// A small repeatable random generator (mulberry32): the same seed always gives the same numbers,
// so re-basing to the same day produces the same orders.
function rng(seedText: string) {
  let h = 1779033703 ^ seedText.length;
  for (let i = 0; i < seedText.length; i++) h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353) << 13 | h >>> 19;
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
}
const pick = <T>(rand: () => number, list: T[]): T => list[Math.floor(rand() * list.length)];

const addMinutes = (time: string, minutes: number) => {
  const total = Math.min(23 * 60 + 45, parseInt(time.slice(0, 2)) * 60 + parseInt(time.slice(3)) + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

type Plan = {
  company: (typeof COMPANIES)[number] & { id: number };
  companyId: number; employeeId: number; offset: number; date: string; time: string; addressId: number; packaging: "STANDARD" | "ECO" | "INSULATED";
  status: OrderStatus; lines: PlannedLine[]; request: Prisma.InputJsonObject; cutoffAt: Date; late: boolean; index: number;
};
type PlannedLine = {
  dishId: number; sku: string; name: string; stationId: number | null; stationName: string | null; quantity: number;
  combos: { quantity: number; options: { groupName: string; optionName: string; portion: string | null; priceCents: number }[]; selections: { groupId: number; optionId: number; portionSizeId?: number }[]; unitPriceCents: number }[];
};
type Stage = "DELIVERED" | "OUT_FOR_DELIVERY" | "DISPATCH_READY" | "KITCHEN_READY" | "COOKING_PARTIAL" | "COOKING_NONE";

export async function rebaseDemoOrders(prisma: PrismaClient, now: Date): Promise<DemoSummary> {
  let settings = await loadKitchenSettings(prisma);
  const today = kitchenToday(now, settings.timezone);
  const dayAt = (offset: number) => DateTime.fromISO(today, { zone: "utc" }).plus({ days: offset }).toISODate()!;
  const clamp = (d: Date) => (d.getTime() > now.getTime() ? now : d);
  const at = (date: string, time: string) => DateTime.fromISO(`${date}T${time}`, { zone: settings.timezone }).toJSDate();

  // ---- 1. clear the previous demo orders (and only those) ----
  await prisma.$transaction(
    async (tx) => {
      await tx.invoice.deleteMany({ where: { isDemo: true } }); // frees their orders (invoiceId becomes null)
      await tx.order.deleteMany({ where: { isDemo: true, invoiceId: null } }); // lines, units and events go with them
      await tx.drop.deleteMany({ where: { orders: { none: {} } } });
      await tx.companyHoliday.deleteMany({ where: { name: { startsWith: "Demo:" } } });
      await tx.kitchenHoliday.deleteMany({ where: { name: { startsWith: "Demo:" } } });
    },
    { timeout: 120_000 },
  );

  // ---- 2. holidays that always lie ahead of the review day ----
  const companies = await prisma.company.findMany({
    where: { name: { in: COMPANIES.map((c) => c.name) } },
    include: {
      employees: { orderBy: { id: "asc" } }, addresses: { orderBy: { id: "asc" } }, hiddenDishes: true, hiddenCategories: true,
    },
  });
  for (const def of COMPANIES) {
    if (def.holidayInDays === undefined) continue;
    const company = companies.find((c) => c.name === def.name)!;
    await prisma.companyHoliday.create({ data: { companyId: company.id, date: fromDateString(dayAt(def.holidayInDays)), name: "Demo: company day off" } });
  }
  await prisma.kitchenHoliday.upsert({ where: { date: fromDateString(dayAt(9)) }, update: {}, create: { date: fromDateString(dayAt(9)), name: "Demo: kitchen deep-clean" } });
  settings = await loadKitchenSettings(prisma); // cut-offs below must see the holiday just added
  const companyHolidays = new Map<number, Set<string>>();
  for (const h of await prisma.companyHoliday.findMany()) {
    const set = companyHolidays.get(h.companyId) ?? new Set<string>();
    set.add(toDateString(h.date));
    companyHolidays.set(h.companyId, set);
  }

  // ---- 3. what the menu looks like for each company ----
  const defaultTier = await prisma.priceTier.findFirstOrThrow({ where: { isDefault: true } });
  const dishes = await prisma.dish.findMany({
    where: { active: true },
    include: { station: true, prices: true, categoryItems: { include: { category: true } }, groups: { orderBy: { displayOrder: "asc" }, include: { portions: true, items: { orderBy: { displayOrder: "asc" }, include: { option: { include: { prices: true, portions: true } } } } } } },
  });
  const driver = await prisma.staff.findUnique({ where: { email: "driver@test.com" } });
  const sizeNames = new Map((await prisma.portionSize.findMany()).map((p) => [p.id, p.name]));

  // ---- 4. plan every order in memory ----
  const plans: Plan[] = [];
  const cycleFuture: OrderStatus[] = ["PLACED", "PLACED", "DRAFT", "PLACED", "CANCELLED", "PLACED", "REJECTED", "PLACED"];
  const cyclePast: OrderStatus[] = ["DELIVERED", "DELIVERED", "DELIVERED", "DELIVERED", "CANCELLED", "DELIVERED", "DELIVERED", "REJECTED", "DELIVERED", "DELIVERED"];
  const cycleConfirmed: OrderStatus[] = ["CONFIRMED", "CONFIRMED", "CONFIRMED", "CONFIRMED", "CANCELLED", "CONFIRMED", "CONFIRMED", "CONFIRMED"];
  let futureCount = 0, pastCount = 0, confirmedCount = 0, index = 0;
  let partialCursor = 0; // walks through started / done / pending for the partly cooked drop

  for (let offset = FIRST_OFFSET; offset <= LAST_OFFSET; offset++) {
    const date = dayAt(offset);
    const weekday = DateTime.fromISO(date, { zone: "utc" }).weekday;
    const cutoffAt = computeCutoff(date, settings);
    for (const def of COMPANIES) {
      const company = companies.find((c) => c.name === def.name)!;
      if (!def.workingDays.includes(weekday) || companyHolidays.get(company.id)?.has(date)) continue;
      const tierId = company.priceTierId ?? defaultTier.id;
      const hiddenDish = new Set(company.hiddenDishes.map((h) => h.dishId));
      const hiddenCategory = new Set(company.hiddenCategories.map((h) => h.categoryId));
      const visible = dishes.filter(
        (d) => d.prices.some((p) => p.tierId === tierId) && !hiddenDish.has(d.id) && d.categoryItems.some((ci) => ci.active && ci.category.active && !hiddenCategory.has(ci.categoryId)),
      );
      const employees = company.employees.filter((e) => e.active);

      for (let k = 0; k < def.ordersPerDay; k++) {
        const rand = rng(`${def.name}|${date}|${k}`);
        // Spread over employees; prefer ones allowed to change the time for the later orders of the day (more drops).
        const flexible = employees.filter((e) => e.canChangeTime);
        const employee = k > 0 && flexible.length > 0 ? flexible[(offset + 10 + k) % flexible.length] : employees[(offset + 10 + k * 3) % employees.length];

        const time = employee.canChangeTime && k > 0 ? addMinutes(def.deliveryTime, 90 * k) : def.deliveryTime;
        const addressId = employee.canChooseAddress && company.addresses.length > 1 && rand() < 0.4 ? company.addresses[1].id : company.addresses[0].id;
        const packaging = employee.canChangePackaging && rand() < 0.4 ? (def.packaging === "ECO" ? "STANDARD" : "ECO") : def.packaging;

        // status: depends on whether the cut-off has already passed
        let status: OrderStatus;
        if (offset < 0) status = cyclePast[pastCount++ % cyclePast.length];
        else if (cutoffAt.getTime() <= now.getTime()) status = cycleConfirmed[confirmedCount++ % cycleConfirmed.length];
        else status = cycleFuture[futureCount++ % cycleFuture.length];

        // dishes and choices
        const lines: PlannedLine[] = [];
        const lineCount = 1 + Math.floor(rand() * 3);
        const chosen = new Set<number>();
        for (let l = 0; l < lineCount; l++) {
          const dish = pick(rand, visible);
          if (chosen.has(dish.id)) continue;
          chosen.add(dish.id);
          const quantity = Math.max(dish.minOrderQty ?? 1, 1 + Math.floor(rand() * 9));
          const dishCents = dish.prices.find((p) => p.tierId === tierId)!.cents;

          const comboCount = dish.groups.length === 0 ? 1 : Math.min(quantity, 1 + Math.floor(rand() * 3));
          const seen = new Set<string>();
          const combos: PlannedLine["combos"] = [];
          for (let c = 0; c < comboCount; c++) {
            const options: PlannedLine["combos"][number]["options"] = [];
            const selections: { groupId: number; optionId: number; portionSizeId?: number }[] = [];
            let ok = true;
            for (const group of dish.groups) {
              const sizes = [...group.portions].sort((a, b) => a.extraCents - b.extraCents);
              const available = group.items.map((i) => i.option).filter((o) => o.active && o.prices.some((p) => p.tierId === tierId) && sizes.every((sz) => o.portions.some((op) => op.portionSizeId === sz.portionSizeId)));
              if (available.length === 0) { if (group.required) ok = false; continue; }
              if (!group.required && rand() < 0.5) continue;
              const option = pick(rand, available);
              const size = sizes.length > 0 ? pick(rand, sizes) : undefined; // groups sold in sizes need one chosen
              selections.push({ groupId: group.id, optionId: option.id, ...(size ? { portionSizeId: size.portionSizeId } : {}) });
              options.push({
                groupName: group.name, optionName: option.name,
                portion: size ? (sizeNames.get(size.portionSizeId) ?? null) : null,
                priceCents: option.prices.find((p) => p.tierId === tierId)!.cents + (size?.extraCents ?? 0),
              });
            }
            const key = selections.map((s) => `${s.groupId}:${s.optionId}:${s.portionSizeId ?? ""}`).join("|");
            if (!ok || seen.has(key)) continue; // an identical combination would have to be merged: skip it
            seen.add(key);
            combos.push({ quantity: 0, options, selections, unitPriceCents: priceCombination(dishCents, options.map((o) => ({ optionCents: o.priceCents, portionExtraCents: 0 }))) });
          }
          if (combos.length === 0) continue;
          // split the dish quantity over the combinations (each at least 1)
          let left = quantity;
          combos.forEach((combo, i) => {
            combo.quantity = i === combos.length - 1 ? left : Math.max(1, Math.min(left - (combos.length - 1 - i), 1 + Math.floor(rand() * Math.max(1, left - (combos.length - 1 - i)))));
            left -= combo.quantity;
          });
          lines.push({ dishId: dish.id, sku: dish.sku, name: dish.name, stationId: dish.station?.id ?? null, stationName: dish.station?.name ?? null, quantity, combos });
        }
        if (lines.length === 0) continue;

        // the saved request (ids only), exactly what the order builder would have stored
        const request: Prisma.InputJsonObject = {
          employeeId: employee.id,
          deliveryDate: date,
          ...(time !== def.deliveryTime ? { deliveryTime: time } : {}),
          ...(addressId !== company.addresses[0].id ? { addressId } : {}),
          ...(packaging !== def.packaging ? { packaging } : {}),
          status: status === "DRAFT" ? "DRAFT" : "PLACED",
          lines: lines.map((l) => ({ dishId: l.dishId, quantity: l.quantity, combinations: l.combos.map((c) => ({ quantity: c.quantity, selections: c.selections })) })),
        };
        plans.push({ company: { ...def, id: company.id }, companyId: company.id, employeeId: employee.id, offset, date, time, addressId, packaging, status, lines, request, cutoffAt, late: offset < 0 && status === "DELIVERED" && index % 5 === 4, index: index++ });
      }
    }
  }

  // ---- 5. drops: group confirmed/delivered orders, then decide how far along each drop is ----
  const dropKey = (p: Plan) => `${p.companyId}|${p.addressId}|${p.date}|${p.time}`;
  const live = plans.filter((p) => p.status === "CONFIRMED" || p.status === "DELIVERED");
  const dropStage = new Map<string, Stage>();
  const todaysDrops = [...new Set(live.filter((p) => p.offset === 0).map(dropKey))].sort((a, b) => a.split("|")[3].localeCompare(b.split("|")[3]));
  // Ordered so that even a day with only three or four drops shows work in progress and work still to start.
  const progression: Stage[] = ["DELIVERED", "COOKING_PARTIAL", "OUT_FOR_DELIVERY", "COOKING_NONE", "DISPATCH_READY", "KITCHEN_READY"];
  todaysDrops.forEach((key, i) => dropStage.set(key, progression[i % progression.length]));
  for (const p of live) {
    if (p.offset < 0) dropStage.set(dropKey(p), "DELIVERED");
    else if (p.offset > 0) dropStage.set(dropKey(p), "COOKING_NONE");
  }
  const driverFor = (p: Plan, stage: Stage, dropIndex: number): number | null => {
    if (!driver) return null;
    if (p.company.defaultDriver) return driver.id;
    // companies without a default driver: some drops still get one, others are left for dispatch to assign
    return stage === "DELIVERED" || stage === "OUT_FOR_DELIVERY" || dropIndex % 2 === 0 ? driver.id : null;
  };

  // ---- 6. write the orders ----
  const created: { order: Order; plan: Plan }[] = [];
  const dropIds = new Map<string, number>();
  let dropCounter = 0;
  for (const p of plans) {
    const totalCents = orderTotal(p.lines.flatMap((l) => l.combos.map((c) => lineTotal(c.unitPriceCents, c.quantity))));
    const planned = plannedTimes(p.date, p.time, companies.find((c) => c.id === p.companyId)!.deliveryMinutes, settings.kitchenReadyBufferMinutes, settings.timezone);
    const deliveryAt = at(p.date, p.time);
    const stage: Stage | null = p.status === "CONFIRMED" || p.status === "DELIVERED" ? dropStage.get(dropKey(p))! : null;

    // timeline
    const placedAt = clamp(new Date(p.cutoffAt.getTime() - 20 * 3600_000 - (p.index % 7) * 1800_000));
    const events: Prisma.OrderEventCreateWithoutOrderInput[] = [{ type: "CREATED", actor: "Demo data", at: placedAt }];
    if (p.status !== "DRAFT") events.push({ type: "PLACED", actor: "Demo data", at: placedAt });
    if (p.status === "CANCELLED") events.push({ type: "CANCELLED", actor: "Demo data", at: clamp(new Date(p.cutoffAt.getTime() - 6 * 3600_000)), meta: { reason: "Plans changed" } });
    if (p.status === "REJECTED") events.push({ type: "REJECTED", actor: "Demo data", at: clamp(new Date(p.cutoffAt.getTime() - 5 * 3600_000)), meta: { reason: "Dish unavailable that day" } });

    const times: Partial<Prisma.OrderUncheckedCreateInput> = {};
    let unitState: (i: number) => UnitStatus = () => "PENDING";
    if (stage) {
      events.push({ type: "CONFIRMED", actor: "System", at: clamp(p.cutoffAt) });
      const kitchenReady = planned.kitchenReadyAt;
      const cookStart = clamp(new Date(kitchenReady.getTime() - 75 * 60_000));
      const allDone = stage !== "COOKING_PARTIAL" && stage !== "COOKING_NONE";
      if (stage !== "COOKING_NONE") { times.kitchenStartedAt = cookStart; events.push({ type: "KITCHEN_STARTED", actor: "Kiran Kitchen", at: cookStart }); }
      if (allDone) {
        times.kitchenReadyAt = clamp(new Date(kitchenReady.getTime() - 10 * 60_000));
        events.push({ type: "KITCHEN_READY", actor: "Kiran Kitchen", at: times.kitchenReadyAt as Date });
        unitState = () => "DONE";
      } else if (stage === "COOKING_PARTIAL") {
        // The cycle runs across the whole day (not per order), so even single-dish orders show every state.
        unitState = () => (["STARTED", "DONE", "PENDING"] as UnitStatus[])[partialCursor++ % 3];
      }
      if (stage === "DISPATCH_READY" || stage === "OUT_FOR_DELIVERY" || stage === "DELIVERED") {
        times.dispatchReadyAt = clamp(planned.dispatchReadyAt); events.push({ type: "DISPATCH_READY", actor: "Dev Dispatch", at: times.dispatchReadyAt as Date });
      }
      if (stage === "OUT_FOR_DELIVERY" || stage === "DELIVERED") {
        times.outForDeliveryAt = clamp(new Date(planned.dispatchReadyAt.getTime() + 5 * 60_000)); events.push({ type: "OUT_FOR_DELIVERY", actor: "Dev Dispatch", at: times.outForDeliveryAt as Date });
      }
      if (stage === "DELIVERED") {
        const lateBy = p.late ? 25 * 60_000 : -5 * 60_000;
        times.deliveredAt = clamp(new Date(deliveryAt.getTime() + lateBy));
        times.onTime = !p.late;
        events.push({ type: "DELIVERED", actor: "Dinesh Driver", at: times.deliveredAt as Date });
      }
    }

    let dropId: number | null = null;
    if (stage) {
      const key = dropKey(p);
      if (!dropIds.has(key)) {
        const drop = await findOrCreateDrop(prisma, { companyId: p.companyId, addressId: p.addressId, deliveryDate: p.date, deliveryTime: p.time });
        dropIds.set(key, drop.id);
        const driverId = driverFor(p, stage, dropCounter++);
        const dropStatus = stage === "DELIVERED" ? "DELIVERED" : stage === "OUT_FOR_DELIVERY" ? "OUT_FOR_DELIVERY" : stage === "DISPATCH_READY" ? "DISPATCH_READY" : "OPEN";
        await prisma.drop.update({
          where: { id: drop.id },
          data: { driverId, status: dropStatus, ...(stage === "DELIVERED" ? { deliveredAt: times.deliveredAt as Date, note: p.index % 2 === 0 ? "Left with reception" : null } : {}) },
        });
      }
      dropId = dropIds.get(key)!;
    }

    let unitIndex = 0;
    const order = await prisma.order.create({
      data: {
        companyId: p.companyId, employeeId: p.employeeId, deliveryDate: fromDateString(p.date), deliveryTime: p.time, addressId: p.addressId,
        // an order inside a delivered drop is itself delivered, even when the day is still today
        packaging: p.packaging, status: stage === "DELIVERED" ? "DELIVERED" : p.status, rejectionReason: p.status === "REJECTED" ? "Dish unavailable that day" : null,
        cutoffAt: p.cutoffAt, plannedDispatchReadyAt: planned.dispatchReadyAt, plannedKitchenReadyAt: planned.kitchenReadyAt,
        totalCents, dropId, requestJson: p.request, isDemo: true, ...times,
        lines: {
          create: p.lines.map((l, li) => ({
            dishId: l.dishId, dishNameSnapshot: l.name, skuSnapshot: l.sku, stationIdSnapshot: l.stationId, stationNameSnapshot: l.stationName, quantity: l.quantity, displayOrder: li,
            combinations: {
              create: l.combos.map((c, ci) => {
                const state = unitState(unitIndex++);
                return {
                  quantity: c.quantity, optionsSnapshot: c.options, unitPriceCents: c.unitPriceCents, lineTotalCents: lineTotal(c.unitPriceCents, c.quantity), displayOrder: ci,
                  ...(stage ? { prepUnit: { create: { stationId: l.stationId, status: state, version: state === "PENDING" ? 0 : state === "STARTED" ? 1 : 2, startedAt: state === "PENDING" ? null : times.kitchenStartedAt ?? clamp(planned.kitchenReadyAt), doneAt: state === "DONE" ? clamp(new Date(planned.kitchenReadyAt.getTime() - 15 * 60_000)) : null } } } : {}),
                };
              }),
            },
          })),
        },
        events: { create: events },
      },
    });
    created.push({ order, plan: p });
  }

  // ---- 7. invoices for the older delivered orders: Acme's are paid, Globex's still open ----
  let invoices = 0;
  for (const [companyName, status] of [["Acme Technologies", "PAID"], ["Globex Pharma", "OPEN"]] as const) {
    const mine = created.filter((c) => c.plan.company.name === companyName && c.order.status === "DELIVERED" && c.plan.offset <= -4);
    if (mine.length === 0) continue;
    const invoice = await prisma.invoice.create({
      data: { companyId: mine[0].order.companyId, status, totalCents: mine.reduce((sum, c) => sum + c.order.totalCents, 0), isDemo: true, createdAt: clamp(new Date(now.getTime() - 2 * 86_400_000)), paidAt: status === "PAID" ? clamp(new Date(now.getTime() - 86_400_000)) : null },
    });
    await prisma.order.updateMany({ where: { id: { in: mine.map((c) => c.order.id) } }, data: { invoiceId: invoice.id } });
    invoices += 1;
  }

  const byStatus: Record<string, number> = {};
  for (const { order } of created) byStatus[order.status] = (byStatus[order.status] ?? 0) + 1;
  return { today, orders: created.length, byStatus, drops: dropIds.size, invoices };
}
