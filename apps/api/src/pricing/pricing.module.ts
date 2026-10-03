import { Module } from "@nestjs/common";
import { PricingController } from "./pricing.controller";
import { PricingService } from "./pricing.service";
import { TiersService } from "./tiers.service";

// PricingService is exported so the catalogue can ask for a reprice when a cost changes.
@Module({
  controllers: [PricingController],
  providers: [PricingService, TiersService],
  exports: [PricingService],
})
export class PricingModule {}
