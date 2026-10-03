import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { createZodDto } from "nestjs-zod";
import { DishInput, DishListQuery, GroupsInput, PERMISSIONS, UpdateDishInput } from "@fernleaf/shared";
import { RequirePermission } from "../auth/require-permission.decorator";
import { DishesService } from "./dishes.service";
import { GroupsService } from "./groups.service";

class DishDto extends createZodDto(DishInput) {}
class UpdateDishDto extends createZodDto(UpdateDishInput) {}
class DishListDto extends createZodDto(DishListQuery) {}
class GroupsDto extends createZodDto(GroupsInput) {}

// There is deliberately no DELETE route: dishes are only deactivated.
@Controller("dishes")
export class DishesController {
  constructor(
    private readonly dishes: DishesService,
    private readonly groups: GroupsService,
  ) {}

  @Get()
  @RequirePermission(PERMISSIONS.CATALOGUE_READ)
  list(@Query() query: DishListDto) {
    return this.dishes.list(query);
  }

  @Get(":id")
  @RequirePermission(PERMISSIONS.CATALOGUE_READ)
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.dishes.findOne(id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.CATALOGUE_WRITE)
  create(@Body() body: DishDto) {
    return this.dishes.create(body);
  }

  @Patch(":id")
  @RequirePermission(PERMISSIONS.CATALOGUE_WRITE)
  update(@Param("id", ParseIntPipe) id: number, @Body() body: UpdateDishDto) {
    return this.dishes.update(id, body);
  }

  @Post(":id/deactivate")
  @RequirePermission(PERMISSIONS.CATALOGUE_WRITE)
  deactivate(@Param("id", ParseIntPipe) id: number) {
    return this.dishes.setActive(id, false);
  }

  @Post(":id/activate")
  @RequirePermission(PERMISSIONS.CATALOGUE_WRITE)
  activate(@Param("id", ParseIntPipe) id: number) {
    return this.dishes.setActive(id, true);
  }

  @Put(":id/groups")
  @RequirePermission(PERMISSIONS.CATALOGUE_WRITE)
  replaceGroups(@Param("id", ParseIntPipe) id: number, @Body() body: GroupsDto) {
    return this.groups.replace(id, body.groups);
  }
}
