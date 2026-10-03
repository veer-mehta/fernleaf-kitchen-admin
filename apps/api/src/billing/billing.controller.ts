import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from "@nestjs/common";
import { createZodDto } from "nestjs-zod";
import { CreateInvoiceInput, InvoiceListQuery, PERMISSIONS, UninvoicedQuery } from "@fernleaf/shared";
import { RequirePermission } from "../auth/require-permission.decorator";
import { BillingService } from "./billing.service";

class CreateDto extends createZodDto(CreateInvoiceInput) {}
class ListDto extends createZodDto(InvoiceListQuery) {}
class UninvoicedDto extends createZodDto(UninvoicedQuery) {}

@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get("billing/uninvoiced")
  @RequirePermission(PERMISSIONS.BILLING_READ)
  uninvoiced(@Query() query: UninvoicedDto) {
    return this.billing.uninvoiced(query.companyId);
  }

  @Get("invoices")
  @RequirePermission(PERMISSIONS.BILLING_READ)
  list(@Query() query: ListDto) {
    return this.billing.list(query);
  }

  @Get("invoices/:id")
  @RequirePermission(PERMISSIONS.BILLING_READ)
  detail(@Param("id", ParseIntPipe) id: number) {
    return this.billing.detail(id);
  }

  @Post("invoices")
  @RequirePermission(PERMISSIONS.BILLING_WRITE)
  create(@Body() body: CreateDto) {
    return this.billing.create(body);
  }

  @Post("invoices/:id/pay")
  @RequirePermission(PERMISSIONS.BILLING_WRITE)
  pay(@Param("id", ParseIntPipe) id: number) {
    return this.billing.pay(id);
  }

  @Post("invoices/:id/void")
  @RequirePermission(PERMISSIONS.BILLING_WRITE)
  void(@Param("id", ParseIntPipe) id: number) {
    return this.billing.void(id);
  }
}
