import { Controller, Get, Param, ParseIntPipe, Post, Query } from "@nestjs/common";
import { createZodDto } from "nestjs-zod";
import { KitchenBoardQuery, PERMISSIONS } from "@fernleaf/shared";
import { AuthUser, CurrentUser } from "../auth/auth-user";
import { RequirePermission } from "../auth/require-permission.decorator";
import { KitchenService } from "./kitchen.service";

class BoardDto extends createZodDto(KitchenBoardQuery) {}

@Controller()
export class KitchenController {
  constructor(private readonly kitchen: KitchenService) {}

  @Get("kitchen/board")
  @RequirePermission(PERMISSIONS.KITCHEN_READ)
  board(@Query() query: BoardDto) {
    return this.kitchen.board(query);
  }

  @Post("kitchen/units/:id/start")
  @RequirePermission(PERMISSIONS.KITCHEN_UPDATE)
  start(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.kitchen.start(id, user);
  }

  @Post("kitchen/units/:id/done")
  @RequirePermission(PERMISSIONS.KITCHEN_UPDATE)
  done(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.kitchen.finish(id, user);
  }

  @Post("orders/:id/force-complete")
  @RequirePermission(PERMISSIONS.ORDERS_OVERRIDE)
  forceComplete(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.kitchen.forceComplete(id, user);
  }
}
