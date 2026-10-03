import { Module } from "@nestjs/common";
import { EmployeeImportController } from "./employee-import.controller";
import { EmployeeImportService } from "./employee-import.service";
import { EmployeesController } from "./employees.controller";
import { EmployeesService } from "./employees.service";

@Module({ controllers: [EmployeesController, EmployeeImportController], providers: [EmployeesService, EmployeeImportService] })
export class EmployeesModule {}
