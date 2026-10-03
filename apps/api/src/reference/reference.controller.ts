import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from "@nestjs/common";
import { createZodDto } from "nestjs-zod";
import { PERMISSIONS, ReferenceInput } from "@fernleaf/shared";
import { RequirePermission } from "../auth/require-permission.decorator";
import { ReferenceService } from "./reference.service";

class ReferenceDto extends createZodDto(ReferenceInput) {}

// One controller for allergens, dietary-tags, stations and portion-sizes: /reference/:kind
@Controller("reference/:kind")
export class ReferenceController {
  constructor(private readonly reference: ReferenceService) {}

  @Get()
  @RequirePermission(PERMISSIONS.CATALOGUE_READ)
  list(@Param("kind") kind: string) {
    return this.reference.list(kind);
  }

  @Post()
  @RequirePermission(PERMISSIONS.CATALOGUE_WRITE)
  create(@Param("kind") kind: string, @Body() body: ReferenceDto) {
    return this.reference.create(kind, body.name);
  }

  @Patch(":id")
  @RequirePermission(PERMISSIONS.CATALOGUE_WRITE)
  update(@Param("kind") kind: string, @Param("id", ParseIntPipe) id: number, @Body() body: ReferenceDto) {
    return this.reference.update(kind, id, body.name);
  }

  @Delete(":id")
  @RequirePermission(PERMISSIONS.CATALOGUE_WRITE)
  remove(@Param("kind") kind: string, @Param("id", ParseIntPipe) id: number) {
    return this.reference.remove(kind, id);
  }
}
