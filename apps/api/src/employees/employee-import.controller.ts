import { Body, Controller, Param, ParseIntPipe, Post } from "@nestjs/common";
import { createZodDto } from "nestjs-zod";
import { EmployeeImportInput, PERMISSIONS } from "@fernleaf/shared";
import { RequirePermission } from "../auth/require-permission.decorator";
import { EmployeeImportService } from "./employee-import.service";

class ImportDto extends createZodDto(EmployeeImportInput) {}

@Controller("companies/:id/employees")
export class EmployeeImportController {
  constructor(private readonly importer: EmployeeImportService) {}

  @Post("import")
  @RequirePermission(PERMISSIONS.EMPLOYEES_WRITE)
  import(@Param("id", ParseIntPipe) id: number, @Body() body: ImportDto) {
    return this.importer.import(id, body.csv);
  }
}
