import { DateTime } from "luxon";

// Works backwards from the delivery time:
//   dispatch-ready = delivery time - the company's delivery minutes
//   kitchen-ready  = dispatch-ready - the kitchen buffer (30 minutes by default)
export function plannedTimes(
  deliveryDate: string,
  deliveryTime: string,
  deliveryMinutes: number,
  bufferMinutes: number,
  tz: string,
): { dispatchReadyAt: Date; kitchenReadyAt: Date } {
  const delivery = DateTime.fromISO(`${deliveryDate}T${deliveryTime}`, { zone: tz });
  const dispatchReady = delivery.minus({ minutes: deliveryMinutes });
  return {
    dispatchReadyAt: dispatchReady.toJSDate(),
    kitchenReadyAt: dispatchReady.minus({ minutes: bufferMinutes }).toJSDate(),
  };
}
