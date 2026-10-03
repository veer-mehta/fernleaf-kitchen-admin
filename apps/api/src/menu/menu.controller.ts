import { Controller, Get, Param, ParseIntPipe } from "@nestjs/common";
import { PERMISSIONS } from "@fernleaf/shared";
import { RequirePermission } from "../auth/require-permission.decorator";
import { MenuService } from "./menu.service";

@Controller("employees/:id/menu")
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  // The preview staff use: the exact menu this employee would see when ordering.
  @Get()
  @RequirePermission(PERMISSIONS.ORDERS_READ)
  preview(@Param("id", ParseIntPipe) id: number) {
    return this.menu.forEmployee(id);
  }
}
