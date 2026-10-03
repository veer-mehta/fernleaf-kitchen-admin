import { Module } from "@nestjs/common";
import { CategoriesController } from "./categories.controller";
import { CategoriesService } from "./categories.service";
import { MenuController } from "./menu.controller";
import { MenuService } from "./menu.service";

// MenuService is exported: order placement (Task 14) uses it to validate dishes.
@Module({ controllers: [MenuController, CategoriesController], providers: [MenuService, CategoriesService], exports: [MenuService] })
export class MenuModule {}
