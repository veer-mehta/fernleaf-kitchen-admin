import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { createZodDto } from "nestjs-zod";
import {
  AddressInput,
  CompanyHolidayInput,
  CompanyInput,
  CompanyListQuery,
  DomainInput,
  HiddenInput,
  PERMISSIONS,
  UpdateAddressInput,
  UpdateCompanyInput,
} from "@fernleaf/shared";
import { RequirePermission } from "../auth/require-permission.decorator";
import { CompaniesService } from "./companies.service";
import { CompanyPartsService } from "./company-parts.service";

class CompanyDto extends createZodDto(CompanyInput) {}
class UpdateCompanyDto extends createZodDto(UpdateCompanyInput) {}
class ListDto extends createZodDto(CompanyListQuery) {}
class DomainDto extends createZodDto(DomainInput) {}
class AddressDto extends createZodDto(AddressInput) {}
class UpdateAddressDto extends createZodDto(UpdateAddressInput) {}
class HolidayDto extends createZodDto(CompanyHolidayInput) {}
class HiddenDto extends createZodDto(HiddenInput) {}

const READ = PERMISSIONS.COMPANIES_READ;
const WRITE = PERMISSIONS.COMPANIES_WRITE;

@Controller("companies")
export class CompaniesController {
  constructor(
    private readonly companies: CompaniesService,
    private readonly parts: CompanyPartsService,
  ) {}

  @Get() @RequirePermission(READ)
  list(@Query() query: ListDto) { return this.companies.list(query); }

  @Post() @RequirePermission(WRITE)
  create(@Body() body: CompanyDto) { return this.companies.create(body); }

  @Get(":id") @RequirePermission(READ)
  findOne(@Param("id", ParseIntPipe) id: number) { return this.companies.findOne(id); }

  @Patch(":id") @RequirePermission(WRITE)
  update(@Param("id", ParseIntPipe) id: number, @Body() body: UpdateCompanyDto) { return this.companies.update(id, body); }

  @Post(":id/domains") @RequirePermission(WRITE)
  addDomain(@Param("id", ParseIntPipe) id: number, @Body() body: DomainDto) { return this.parts.addDomain(id, body.domain); }

  @Delete(":id/domains/:domainId") @RequirePermission(WRITE)
  removeDomain(@Param("id", ParseIntPipe) id: number, @Param("domainId", ParseIntPipe) domainId: number) {
    return this.parts.removeDomain(id, domainId);
  }

  @Post(":id/addresses") @RequirePermission(WRITE)
  addAddress(@Param("id", ParseIntPipe) id: number, @Body() body: AddressDto) { return this.parts.addAddress(id, body); }

  @Patch(":id/addresses/:addressId") @RequirePermission(WRITE)
  updateAddress(@Param("id", ParseIntPipe) id: number, @Param("addressId", ParseIntPipe) addressId: number, @Body() body: UpdateAddressDto) {
    return this.parts.updateAddress(id, addressId, body);
  }

  @Delete(":id/addresses/:addressId") @RequirePermission(WRITE)
  removeAddress(@Param("id", ParseIntPipe) id: number, @Param("addressId", ParseIntPipe) addressId: number) {
    return this.parts.removeAddress(id, addressId);
  }

  @Post(":id/holidays") @RequirePermission(WRITE)
  addHoliday(@Param("id", ParseIntPipe) id: number, @Body() body: HolidayDto) { return this.parts.addHoliday(id, body.date, body.name); }

  @Delete(":id/holidays/:holidayId") @RequirePermission(WRITE)
  removeHoliday(@Param("id", ParseIntPipe) id: number, @Param("holidayId", ParseIntPipe) holidayId: number) {
    return this.parts.removeHoliday(id, holidayId);
  }

  @Put(":id/hidden") @RequirePermission(WRITE)
  setHidden(@Param("id", ParseIntPipe) id: number, @Body() body: HiddenDto) {
    return this.parts.setHidden(id, body.categoryIds, body.dishIds);
  }
}
