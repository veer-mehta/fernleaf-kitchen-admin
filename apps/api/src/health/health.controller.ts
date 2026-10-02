import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  // No auth here on purpose: uptime pings and the deploy warm-up step call this.
  // (Task 4 adds a global guard; this route is marked @Public there.)
  @Get()
  check() {
    return { ok: true };
  }
}
