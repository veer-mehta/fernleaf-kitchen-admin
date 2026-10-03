import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from "@nestjs/common";
import { createZodDto } from "nestjs-zod";
import { EmployeeInput, EmployeeListQuery, PERMISSIONS, UpdateEmployeeInput } from "@fernleaf/shared";
import { RequirePermission } from "../auth/require-permission.decorator";
import { EmployeesService } from "./employees.service";

class EmployeeDto extends createZodDto(EmployeeInput) {}
class UpdateEmployeeDto extends createZodDto(UpdateEmployeeInput) {}
class ListDto extends createZodDto(EmployeeListQuery) {}

@Controller("employees")
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @RequirePermission(PERMISSIONS.EMPLOYEES_READ)
  list(@Query() query: ListDto) {
    return this.employees.list(query);
  }

  @Post()
  @RequirePermission(PERMISSIONS.EMPLOYEES_WRITE)
  create(@Body() body: EmployeeDto) {
    return this.employees.create(body);
  }

  @Get(":id")
  @RequirePermission(PERMISSIONS.EMPLOYEES_READ)
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.employees.findOne(id);
  }

  @Patch(":id")
  @RequirePermission(PERMISSIONS.EMPLOYEES_WRITE)
  update(@Param("id", ParseIntPipe) id: number, @Body() body: UpdateEmployeeDto) {
    return this.employees.update(id, body);
  }
}
