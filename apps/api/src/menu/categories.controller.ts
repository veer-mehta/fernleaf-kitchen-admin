import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put } from "@nestjs/common";
import { createZodDto } from "nestjs-zod";
import {
  CategoryInput,
  CategoryItemsInput,
  CategoryOrderInput,
  PERMISSIONS,
  UpdateCategoryInput,
} from "@fernleaf/shared";
import { RequirePermission } from "../auth/require-permission.decorator";
import { CategoriesService } from "./categories.service";

class CategoryDto extends createZodDto(CategoryInput) {}
class UpdateCategoryDto extends createZodDto(UpdateCategoryInput) {}
class OrderDto extends createZodDto(CategoryOrderInput) {}
class ItemsDto extends createZodDto(CategoryItemsInput) {}

@Controller("categories")
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @RequirePermission(PERMISSIONS.CATALOGUE_READ)
  list() {
    return this.categories.list();
  }

  @Post()
  @RequirePermission(PERMISSIONS.CATALOGUE_WRITE)
  create(@Body() body: CategoryDto) {
    return this.categories.create(body);
  }

  @Put("order")
  @RequirePermission(PERMISSIONS.CATALOGUE_WRITE)
  reorder(@Body() body: OrderDto) {
    return this.categories.reorder(body.ids);
  }

  @Patch(":id")
  @RequirePermission(PERMISSIONS.CATALOGUE_WRITE)
  update(@Param("id", ParseIntPipe) id: number, @Body() body: UpdateCategoryDto) {
    return this.categories.update(id, body);
  }

  @Delete(":id")
  @RequirePermission(PERMISSIONS.CATALOGUE_WRITE)
  remove(@Param("id", ParseIntPipe) id: number) {
    return this.categories.remove(id);
  }

  @Put(":id/items")
  @RequirePermission(PERMISSIONS.CATALOGUE_WRITE)
  replaceItems(@Param("id", ParseIntPipe) id: number, @Body() body: ItemsDto) {
    return this.categories.replaceItems(id, body.items);
  }
}
