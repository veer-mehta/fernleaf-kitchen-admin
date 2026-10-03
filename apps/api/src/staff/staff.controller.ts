import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post } from "@nestjs/common";
import { createZodDto } from "nestjs-zod";
import { CreateStaffInput, PERMISSIONS, UpdateStaffInput } from "@fernleaf/shared";
import { AuthUser, CurrentUser } from "../auth/auth-user";
import { RequirePermission } from "../auth/require-permission.decorator";
import { StaffService } from "./staff.service";

class CreateStaffDto extends createZodDto(CreateStaffInput) {}
class UpdateStaffDto extends createZodDto(UpdateStaffInput) {}

@Controller()
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get("staff")
  @RequirePermission(PERMISSIONS.STAFF_READ)
  list() {
    return this.staff.list();
  }

  @Get("roles")
  @RequirePermission(PERMISSIONS.STAFF_READ)
  roles() {
    return this.staff.listRoles();
  }

  // Dispatch and admin pick drivers from this list (company default driver, drop assignment).
  @Get("drivers")
  @RequirePermission(PERMISSIONS.COMPANIES_READ)
  drivers() {
    return this.staff.listDrivers();
  }

  @Post("staff")
  @RequirePermission(PERMISSIONS.STAFF_WRITE)
  create(@Body() body: CreateStaffDto) {
    return this.staff.create(body);
  }

  @Patch("staff/:id")
  @RequirePermission(PERMISSIONS.STAFF_WRITE)
  update(
    @Param("id", ParseIntPipe) id: number,
    @Body() body: UpdateStaffDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.staff.update(id, actor.id, body);
  }
}
