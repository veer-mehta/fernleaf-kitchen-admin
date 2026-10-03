import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PERMISSIONS, type Paged } from "@fernleaf/shared";
import { toDateString } from "../common/dates";
import { DomainError } from "../common/domain-error";
import { isRecordNotFound, isUniqueViolation, uniqueTarget } from "../common/prisma-errors";
import { PrismaService } from "../prisma/prisma.service";
import { assertDomainsClaimable } from "./domain-rules";

const detailInclude = {
  priceTier: true,
  ownerEmployee: true,
  defaultDriver: true,
  domains: { orderBy: { domain: "asc" } },
  addresses: { orderBy: { id: "asc" } },
  holidays: { orderBy: { date: "asc" } },
  hiddenCategories: true,
  hiddenDishes: true,
} satisfies Prisma.CompanyInclude;

type CompanyRow = Prisma.CompanyGetPayload<{ include: typeof detailInclude }>;

export function toCompanyDetail(c: CompanyRow) {
  return {
    id: c.id,
    name: c.name,
    priceTierId: c.priceTierId,
    priceTier: c.priceTier ? { id: c.priceTier.id, name: c.priceTier.name } : null,
    billingContactName: c.billingContactName,
    billingContactEmail: c.billingContactEmail,
    billingContactPhone: c.billingContactPhone,
    ownerEmployee: c.ownerEmployee ? { id: c.ownerEmployee.id, name: c.ownerEmployee.name } : null,
    workingDays: c.workingDays,
    deliveryTime: c.deliveryTime,
    deliveryMinutes: c.deliveryMinutes,
    defaultPackaging: c.defaultPackaging,
    driverInstructions: c.driverInstructions,
    defaultDriver: c.defaultDriver ? { id: c.defaultDriver.id, name: c.defaultDriver.name } : null,
    domains: c.domains.map((d) => ({ id: d.id, domain: d.domain })),
    addresses: c.addresses.map((a) => ({
      id: a.id, label: a.label, line1: a.line1, line2: a.line2, city: a.city, postalCode: a.postalCode, instructions: a.instructions,
    })),
    holidays: c.holidays.map((h) => ({ id: h.id, date: toDateString(h.date), name: h.name })),
    hiddenCategoryIds: c.hiddenCategories.map((h) => h.categoryId),
    hiddenDishIds: c.hiddenDishes.map((h) => h.dishId),
  };
}

interface CompanyFields {
  name?: string;
  priceTierId?: number | null;
  billingContactName?: string;
  billingContactEmail?: string;
  billingContactPhone?: string;
  workingDays?: number[];
  deliveryTime?: string;
  deliveryMinutes?: number;
  defaultPackaging?: "STANDARD" | "ECO" | "INSULATED";
  driverInstructions?: string;
  defaultDriverId?: number | null;
  ownerEmployeeId?: number | null;
}

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: { page: number; pageSize: number; search?: string }): Promise<Paged<unknown>> {
    const where: Prisma.CompanyWhereInput = q.search ? { name: { contains: q.search, mode: "insensitive" } } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.company.findMany({
        where,
        orderBy: { name: "asc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { priceTier: true, domains: { orderBy: { domain: "asc" } }, _count: { select: { employees: true } } },
      }),
      this.prisma.company.count({ where }),
    ]);
    return {
      total,
      items: rows.map((c) => ({
        id: c.id,
        name: c.name,
        tier: c.priceTier ? { id: c.priceTier.id, name: c.priceTier.name } : null,
        employeeCount: c._count.employees,
        domains: c.domains.map((d) => d.domain),
      })),
    };
  }

  async findOne(id: number) {
    const company = await this.prisma.company.findUnique({ where: { id }, include: detailInclude });
    if (!company) throw new DomainError("NOT_FOUND", "Company not found", 404);
    return toCompanyDetail(company);
  }

  async create(
    input: Required<Omit<CompanyFields, "ownerEmployeeId">> & {
      domains: string[];
      addresses: { label: string; line1: string; line2: string; city: string; postalCode: string; instructions: string }[];
    },
  ) {
    await assertDomainsClaimable(this.prisma, input.domains, "domains");
    await this.assertReferences(input);
    try {
      const { domains, addresses, ...fields } = input;
      const company = await this.prisma.company.create({
        data: {
          ...fields,
          domains: { create: domains.map((domain) => ({ domain })) },
          addresses: { create: addresses },
        },
        include: detailInclude,
      });
      return toCompanyDetail(company);
    } catch (e) {
      throw this.translate(e);
    }
  }

  async update(id: number, input: CompanyFields) {
    if (!(await this.prisma.company.findUnique({ where: { id } }))) {
      throw new DomainError("NOT_FOUND", "Company not found", 404);
    }
    await this.assertReferences(input, id);
    try {
      const company = await this.prisma.company.update({ where: { id }, data: input, include: detailInclude });
      return toCompanyDetail(company);
    } catch (e) {
      throw this.translate(e);
    }
  }

  // The price tier, default driver and owner must point at things that exist and make sense.
  private async assertReferences(input: CompanyFields, companyId?: number) {
    const fields: Record<string, string> = {};

    if (input.priceTierId && !(await this.prisma.priceTier.findUnique({ where: { id: input.priceTierId } }))) {
      fields.priceTierId = "That price tier does not exist";
    }
    if (input.defaultDriverId) {
      // Anyone whose role holds the driver permission can be a driver; no role names are checked.
      const driver = await this.prisma.staff.findFirst({
        where: {
          id: input.defaultDriverId,
          active: true,
          role: { permissions: { some: { permission: { code: PERMISSIONS.DRIVER_OWN_DROPS } } } },
        },
      });
      if (!driver) fields.defaultDriverId = "That person is not an active driver";
    }
    if (input.ownerEmployeeId) {
      const owner = await this.prisma.employee.findUnique({ where: { id: input.ownerEmployeeId } });
      if (!owner || owner.companyId !== companyId) fields.ownerEmployeeId = "The owner must be an employee of this company";
    }

    if (Object.keys(fields).length > 0) {
      throw new DomainError("INVALID_REFERENCE", "Some selected items are not valid", 400, fields);
    }
  }

  private translate(e: unknown): unknown {
    if (isUniqueViolation(e)) {
      const target = uniqueTarget(e);
      if (target.includes("domain")) {
        return new DomainError("DOMAIN_TAKEN", "A domain already belongs to a company", 409, { domains: "A domain already belongs to a company" });
      }
      if (target.includes("ownerEmployeeId")) {
        return new DomainError("OWNER_TAKEN", "That employee already owns another company", 409, { ownerEmployeeId: "That employee already owns another company" });
      }
      return new DomainError("NAME_TAKEN", "A company with that name already exists", 409, { name: "A company with that name already exists" });
    }
    if (isRecordNotFound(e)) return new DomainError("NOT_FOUND", "Company not found", 404);
    return e;
  }
}
