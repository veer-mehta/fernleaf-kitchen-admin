import { Controller, Get, Query } from "@nestjs/common";
import { createZodDto } from "nestjs-zod";
import { DashboardQuery, PERMISSIONS } from "@fernleaf/shared";
import { AuthUser, CurrentUser } from "../auth/auth-user";
import { RequirePermission } from "../auth/require-permission.decorator";
import { DashboardService } from "./dashboard.service";

class QueryDto extends createZodDto(DashboardQuery) {}

@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get("admin")
  @RequirePermission(PERMISSIONS.DASHBOARD_ADMIN)
  admin(@Query() query: QueryDto) {
    return this.dashboard.admin(query);
  }

  @Get("kitchen")
  @RequirePermission(PERMISSIONS.KITCHEN_READ)
  kitchen(@Query() query: QueryDto) {
    return this.dashboard.kitchenDashboard(query);
  }

  @Get("dispatch")
  @RequirePermission(PERMISSIONS.DISPATCH_READ)
  dispatch(@Query() query: QueryDto) {
    return this.dashboard.dispatchDashboard(query);
  }

  @Get("driver")
  @RequirePermission(PERMISSIONS.DRIVER_OWN_DROPS)
  driver(@CurrentUser() user: AuthUser) {
    return this.dashboard.driverDashboard(user);
  }
}
