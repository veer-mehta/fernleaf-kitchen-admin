import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from "@nestjs/common";
import { createZodDto } from "nestjs-zod";
import { OptionInput, OptionListQuery, PERMISSIONS, UpdateOptionInput } from "@fernleaf/shared";
import { RequirePermission } from "../auth/require-permission.decorator";
import { OptionsService } from "./options.service";

class OptionDto extends createZodDto(OptionInput) {}
class UpdateOptionDto extends createZodDto(UpdateOptionInput) {}
class OptionListDto extends createZodDto(OptionListQuery) {}

@Controller("options")
export class OptionsController {
  constructor(private readonly options: OptionsService) {}

  @Get()
  @RequirePermission(PERMISSIONS.CATALOGUE_READ)
  list(@Query() query: OptionListDto) {
    return this.options.list(query);
  }

  @Post()
  @RequirePermission(PERMISSIONS.CATALOGUE_WRITE)
  create(@Body() body: OptionDto) {
    return this.options.create(body);
  }

  @Patch(":id")
  @RequirePermission(PERMISSIONS.CATALOGUE_WRITE)
  update(@Param("id", ParseIntPipe) id: number, @Body() body: UpdateOptionDto) {
    return this.options.update(id, body);
  }
}
