import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from "@nestjs/common";
import { createZodDto } from "nestjs-zod";
import { HolidayInput, PERMISSIONS, SettingsInput } from "@fernleaf/shared";
import { RequirePermission } from "../auth/require-permission.decorator";
import { SettingsService } from "./settings.service";

class SettingsDto extends createZodDto(SettingsInput) {}
class HolidayDto extends createZodDto(HolidayInput) {}

@Controller()
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get("settings")
  @RequirePermission(PERMISSIONS.SETTINGS_READ)
  get() {
    return this.settings.getKitchenSettings();
  }

  @Put("settings")
  @RequirePermission(PERMISSIONS.SETTINGS_WRITE)
  update(@Body() body: SettingsDto) {
    return this.settings.update(body);
  }

  @Get("kitchen-holidays")
  @RequirePermission(PERMISSIONS.SETTINGS_READ)
  holidays() {
    return this.settings.listHolidays();
  }

  @Post("kitchen-holidays")
  @RequirePermission(PERMISSIONS.SETTINGS_WRITE)
  addHoliday(@Body() body: HolidayDto) {
    return this.settings.addHoliday(body.date, body.name);
  }

  @Delete("kitchen-holidays/:id")
  @RequirePermission(PERMISSIONS.SETTINGS_WRITE)
  removeHoliday(@Param("id", ParseIntPipe) id: number) {
    return this.settings.removeHoliday(id);
  }
}
