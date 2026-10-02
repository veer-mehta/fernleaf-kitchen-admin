import { Controller, Get } from "@nestjs/common";
import { Public } from "../auth/public.decorator";

@Controller("health")
export class HealthController {
  // Public on purpose: uptime pings and the deploy warm-up step call this.
  @Public()
  @Get()
  check() {
    return { ok: true };
  }
}
