import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from "@nestjs/common";
import { createZodDto } from "nestjs-zod";
import { AssignDriverInput, DeliveredInput, DispatchBoardQuery, PERMISSIONS } from "@fernleaf/shared";
import { AuthUser, CurrentUser } from "../auth/auth-user";
import { RequirePermission } from "../auth/require-permission.decorator";
import { DispatchService } from "./dispatch.service";

class BoardDto extends createZodDto(DispatchBoardQuery) {}
class AssignDto extends createZodDto(AssignDriverInput) {}
class DeliveredDto extends createZodDto(DeliveredInput) {}

@Controller()
export class DispatchController {
  constructor(private readonly dispatch: DispatchService) {}

  @Get("dispatch/board")
  @RequirePermission(PERMISSIONS.DISPATCH_READ)
  board(@Query() query: BoardDto) {
    return this.dispatch.board(query);
  }

  @Patch("drops/:id/driver")
  @RequirePermission(PERMISSIONS.DISPATCH_UPDATE)
  assign(@Param("id", ParseIntPipe) id: number, @Body() body: AssignDto) {
    return this.dispatch.assignDriver(id, body.driverId);
  }

  @Post("drops/:id/dispatch-ready")
  @RequirePermission(PERMISSIONS.DISPATCH_UPDATE)
  dispatchReady(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.dispatch.advance(id, "dispatch-ready", user);
  }

  @Post("drops/:id/out-for-delivery")
  @RequirePermission(PERMISSIONS.DISPATCH_UPDATE)
  outForDelivery(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.dispatch.advance(id, "out-for-delivery", user);
  }

  @Post("drops/:id/delivered")
  @RequirePermission(PERMISSIONS.DISPATCH_UPDATE)
  delivered(@Param("id", ParseIntPipe) id: number, @Body() body: DeliveredDto, @CurrentUser() user: AuthUser) {
    return this.dispatch.advance(id, "delivered", user, body);
  }
}
