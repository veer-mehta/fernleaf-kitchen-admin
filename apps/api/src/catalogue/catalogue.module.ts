import { Module } from "@nestjs/common";
import { PricingModule } from "../pricing/pricing.module";
import { DishesController } from "./dishes.controller";
import { DishesService } from "./dishes.service";
import { GroupsService } from "./groups.service";
import { OptionsController } from "./options.controller";
import { OptionsService } from "./options.service";

@Module({
  imports: [PricingModule],
  controllers: [DishesController, OptionsController],
  providers: [DishesService, GroupsService, OptionsService],
})
export class CatalogueModule {}
