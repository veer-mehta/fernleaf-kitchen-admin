import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put } from "@nestjs/common";
import { createZodDto } from "nestjs-zod";
import { DishPriceInput, OptionPriceInput, PERMISSIONS, TierInput, UpdateTierInput } from "@fernleaf/shared";
import { RequirePermission } from "../auth/require-permission.decorator";
import { PricingService } from "./pricing.service";
import { TiersService } from "./tiers.service";

class TierDto extends createZodDto(TierInput) {}
class UpdateTierDto extends createZodDto(UpdateTierInput) {}
class DishPriceDto extends createZodDto(DishPriceInput) {}
class OptionPriceDto extends createZodDto(OptionPriceInput) {}

@Controller("tiers")
export class PricingController {
  constructor(
    private readonly tiers: TiersService,
    private readonly pricing: PricingService,
  ) {}

  @Get()
  @RequirePermission(PERMISSIONS.PRICING_READ)
  list() {
    return this.tiers.list();
  }

  @Post()
  @RequirePermission(PERMISSIONS.PRICING_WRITE)
  create(@Body() body: TierDto) {
    return this.tiers.create(body);
  }

  @Patch(":id")
  @RequirePermission(PERMISSIONS.PRICING_WRITE)
  update(@Param("id", ParseIntPipe) id: number, @Body() body: UpdateTierDto) {
    return this.tiers.update(id, body);
  }

  @Get(":id/grid")
  @RequirePermission(PERMISSIONS.PRICING_READ)
  grid(@Param("id", ParseIntPipe) id: number) {
    return this.tiers.grid(id);
  }

  @Get(":id/missing")
  @RequirePermission(PERMISSIONS.PRICING_READ)
  missing(@Param("id", ParseIntPipe) id: number) {
    return this.tiers.missing(id);
  }

  @Put(":id/dish-prices/:dishId")
  @RequirePermission(PERMISSIONS.PRICING_WRITE)
  setDishPrice(
    @Param("id", ParseIntPipe) id: number,
    @Param("dishId", ParseIntPipe) dishId: number,
    @Body() body: DishPriceDto,
  ) {
    return this.pricing.setDishPrice(id, dishId, body.cents);
  }

  @Delete(":id/dish-prices/:dishId")
  @RequirePermission(PERMISSIONS.PRICING_WRITE)
  clearDishPrice(@Param("id", ParseIntPipe) id: number, @Param("dishId", ParseIntPipe) dishId: number) {
    return this.pricing.clearDishPrice(id, dishId);
  }

  @Put(":id/option-prices/:optionId")
  @RequirePermission(PERMISSIONS.PRICING_WRITE)
  setOptionPrice(
    @Param("id", ParseIntPipe) id: number,
    @Param("optionId", ParseIntPipe) optionId: number,
    @Body() body: OptionPriceDto,
  ) {
    return this.pricing.setOptionPrice(id, optionId, body.cents);
  }

  @Delete(":id/option-prices/:optionId")
  @RequirePermission(PERMISSIONS.PRICING_WRITE)
  clearOptionPrice(@Param("id", ParseIntPipe) id: number, @Param("optionId", ParseIntPipe) optionId: number) {
    return this.pricing.clearOptionPrice(id, optionId);
  }
}
