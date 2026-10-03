import { Body, Controller, Get, Param, ParseIntPipe, Post } from "@nestjs/common";
import { createZodDto } from "nestjs-zod";
import { DeliveredInput, PERMISSIONS } from "@fernleaf/shared";
import { AuthUser, CurrentUser } from "../auth/auth-user";
import { RequirePermission } from "../auth/require-permission.decorator";
import { DriverService } from "./driver.service";

class DeliveredDto extends createZodDto(DeliveredInput) {}

@Controller("driver")
export class DriverController {
  constructor(private readonly driver: DriverService) {}

  @Get("drops")
  @RequirePermission(PERMISSIONS.DRIVER_OWN_DROPS)
  drops(@CurrentUser() user: AuthUser) {
    return this.driver.list(user);
  }

  @Post("drops/:id/delivered")
  @RequirePermission(PERMISSIONS.DRIVER_OWN_DROPS)
  delivered(@Param("id", ParseIntPipe) id: number, @Body() body: DeliveredDto, @CurrentUser() user: AuthUser) {
    return this.driver.deliver(user, id, body);
  }
}
