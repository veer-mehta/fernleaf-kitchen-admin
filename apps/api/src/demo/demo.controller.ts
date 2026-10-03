import { Controller, Post } from "@nestjs/common";
import { PERMISSIONS } from "@fernleaf/shared";
import { RequirePermission } from "../auth/require-permission.decorator";
import { DemoService } from "./demo.service";

@Controller("demo")
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  // The admin's "Refresh demo data" button: moves the demo orders to be around today.
  @Post("refresh")
  @RequirePermission(PERMISSIONS.SETTINGS_WRITE)
  refresh() {
    return this.demo.refresh();
  }
}
