import { Injectable } from "@nestjs/common";
import { fromDateString, toDateString } from "../common/dates";
import { DomainError } from "../common/domain-error";
import { isForeignKeyViolation, isUniqueViolation } from "../common/prisma-errors";
import { PrismaService } from "../prisma/prisma.service";
import { assertDomainsClaimable } from "./domain-rules";

interface AddressFields {
  label?: string;
  line1?: string;
  line2?: string;
  city?: string;
  postalCode?: string;
  instructions?: string;
}

// The sub-records of a company: domains, addresses, holidays and the hidden menu items.
@Injectable()
export class CompanyPartsService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertCompany(companyId: number) {
    if (!(await this.prisma.company.findUnique({ where: { id: companyId } }))) {
      throw new DomainError("NOT_FOUND", "Company not found", 404);
    }
  }

  // ---- domains ----
  async addDomain(companyId: number, domain: string) {
    await this.assertCompany(companyId);
    await assertDomainsClaimable(this.prisma, [domain], "domain");
    const created = await this.prisma.companyDomain.create({ data: { companyId, domain } });
    return { id: created.id, domain: created.domain };
  }

  async removeDomain(companyId: number, domainId: number) {
    const domain = await this.prisma.companyDomain.findFirst({ where: { id: domainId, companyId } });
    if (!domain) throw new DomainError("NOT_FOUND", "Domain not found", 404);

    if ((await this.prisma.companyDomain.count({ where: { companyId } })) === 1) {
      throw new DomainError("LAST_DOMAIN", "A company needs at least one email domain", 400);
    }
    // Employees' emails are checked against the domains, so one still in use cannot go.
    const users = await this.prisma.employee.count({ where: { companyId, email: { endsWith: `@${domain.domain}` } } });
    if (users > 0) {
      throw new DomainError("DOMAIN_IN_USE", `${users} employee(s) use ${domain.domain} email addresses`, 409);
    }
    await this.prisma.companyDomain.delete({ where: { id: domainId } });
    return { ok: true };
  }

  // ---- addresses ----
  async addAddress(companyId: number, input: Required<AddressFields>) {
    await this.assertCompany(companyId);
    return this.prisma.companyAddress.create({ data: { companyId, ...input } });
  }

  async updateAddress(companyId: number, addressId: number, input: AddressFields) {
    // Looking up by BOTH ids stops one company's address being edited through another's URL.
    if (!(await this.prisma.companyAddress.findFirst({ where: { id: addressId, companyId } }))) {
      throw new DomainError("NOT_FOUND", "Address not found", 404);
    }
    return this.prisma.companyAddress.update({ where: { id: addressId }, data: input });
  }

  async removeAddress(companyId: number, addressId: number) {
    if (!(await this.prisma.companyAddress.findFirst({ where: { id: addressId, companyId } }))) {
      throw new DomainError("NOT_FOUND", "Address not found", 404);
    }
    if ((await this.prisma.companyAddress.count({ where: { companyId } })) === 1) {
      throw new DomainError("LAST_ADDRESS", "A company needs at least one delivery address", 400);
    }
    try {
      await this.prisma.companyAddress.delete({ where: { id: addressId } });
      return { ok: true };
    } catch (e) {
      // Orders point at addresses, so one that has been used cannot be deleted.
      if (isForeignKeyViolation(e)) throw new DomainError("IN_USE", "Orders have been delivered to this address", 409);
      throw e;
    }
  }

  // ---- company holidays ----
  async addHoliday(companyId: number, date: string, name: string) {
    await this.assertCompany(companyId);
    try {
      const h = await this.prisma.companyHoliday.create({ data: { companyId, date: fromDateString(date), name } });
      return { id: h.id, date: toDateString(h.date), name: h.name };
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new DomainError("HOLIDAY_EXISTS", "That date is already a holiday", 409, { date: "That date is already a holiday" });
      }
      throw e;
    }
  }

  async removeHoliday(companyId: number, holidayId: number) {
    const found = await this.prisma.companyHoliday.deleteMany({ where: { id: holidayId, companyId } });
    if (found.count === 0) throw new DomainError("NOT_FOUND", "Holiday not found", 404);
    return { ok: true };
  }

  // ---- hidden categories and dishes ----
  async setHidden(companyId: number, categoryIds: number[], dishIds: number[]) {
    await this.assertCompany(companyId);
    const categories = [...new Set(categoryIds)];
    const dishes = [...new Set(dishIds)];

    const fields: Record<string, string> = {};
    if ((await this.prisma.category.count({ where: { id: { in: categories } } })) !== categories.length) {
      fields.categoryIds = "One of the categories does not exist";
    }
    if ((await this.prisma.dish.count({ where: { id: { in: dishes } } })) !== dishes.length) {
      fields.dishIds = "One of the dishes does not exist";
    }
    if (Object.keys(fields).length > 0) {
      throw new DomainError("INVALID_REFERENCE", "Some selected items do not exist", 400, fields);
    }

    await this.prisma.$transaction([
      this.prisma.companyHiddenCategory.deleteMany({ where: { companyId } }),
      this.prisma.companyHiddenDish.deleteMany({ where: { companyId } }),
      this.prisma.companyHiddenCategory.createMany({ data: categories.map((categoryId) => ({ companyId, categoryId })) }),
      this.prisma.companyHiddenDish.createMany({ data: dishes.map((dishId) => ({ companyId, dishId })) }),
    ]);
    return { ok: true };
  }
}
