import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from "@nestjs/common";
import { createZodDto } from "nestjs-zod";
import { CancelInput, OrderInput, OrderListQuery, OverrideInput, PERMISSIONS, ProcessCutoffInput, RejectInput } from "@fernleaf/shared";
import { AuthUser, CurrentUser } from "../auth/auth-user";
import { RequirePermission } from "../auth/require-permission.decorator";
import { CutoffProcessor } from "./cutoff-processor.service";
import { OrdersQueryService } from "./orders-query.service";
import { OrdersService } from "./orders.service";

class OrderDto extends createZodDto(OrderInput) {}
class CancelDto extends createZodDto(CancelInput) {}
class RejectDto extends createZodDto(RejectInput) {}
class OverrideDto extends createZodDto(OverrideInput) {}
class ProcessCutoffDto extends createZodDto(ProcessCutoffInput) {}
class ListDto extends createZodDto(OrderListQuery) {}

@Controller("orders")
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly query: OrdersQueryService,
    private readonly cutoff: CutoffProcessor,
  ) {}

  @Get()
  @RequirePermission(PERMISSIONS.ORDERS_READ)
  list(@Query() query: ListDto) {
    return this.query.list(query);
  }

  // Lets a reviewer (or an admin) run the cut-off for a date whose cut-off has already passed,
  // without waiting for the background job.
  @Post("process-cutoff")
  @RequirePermission(PERMISSIONS.ORDERS_OVERRIDE)
  processCutoff(@Body() body: ProcessCutoffDto, @CurrentUser() user: AuthUser) {
    return this.cutoff.processDate(body.date, user.name);
  }

  @Get(":id")
  @RequirePermission(PERMISSIONS.ORDERS_READ)
  detail(@Param("id", ParseIntPipe) id: number) {
    return this.query.detail(id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.ORDERS_WRITE)
  create(@Body() body: OrderDto, @CurrentUser() user: AuthUser) {
    return this.orders.create(body, user);
  }

  @Patch(":id")
  @RequirePermission(PERMISSIONS.ORDERS_WRITE)
  update(@Param("id", ParseIntPipe) id: number, @Body() body: OrderDto, @CurrentUser() user: AuthUser) {
    return this.orders.update(id, body, user);
  }

  @Post(":id/place")
  @RequirePermission(PERMISSIONS.ORDERS_WRITE)
  place(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.orders.place(id, user);
  }

  @Post(":id/cancel")
  @RequirePermission(PERMISSIONS.ORDERS_WRITE)
  cancel(@Param("id", ParseIntPipe) id: number, @Body() body: CancelDto, @CurrentUser() user: AuthUser) {
    return this.orders.cancel(id, body.reason, user);
  }

  @Post(":id/reject")
  @RequirePermission(PERMISSIONS.ORDERS_OVERRIDE)
  reject(@Param("id", ParseIntPipe) id: number, @Body() body: RejectDto, @CurrentUser() user: AuthUser) {
    return this.orders.reject(id, body.reason, user);
  }

  @Patch(":id/override")
  @RequirePermission(PERMISSIONS.ORDERS_OVERRIDE)
  override(@Param("id", ParseIntPipe) id: number, @Body() body: OverrideDto, @CurrentUser() user: AuthUser) {
    return this.orders.override(id, body, user);
  }
}
