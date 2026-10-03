import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Paged } from "@fernleaf/shared";
import { assertReferencesExist, toJoinRows } from "../catalogue/references";
import { DomainError } from "../common/domain-error";
import { isUniqueViolation } from "../common/prisma-errors";
import { PrismaService } from "../prisma/prisma.service";

const include = {
  company: true,
  allergens: { include: { allergen: true } },
  dietaryTags: { include: { dietaryTag: true } },
} satisfies Prisma.EmployeeInclude;

function toEmployee(e: Prisma.EmployeeGetPayload<{ include: typeof include }>) {
  return {
    id: e.id,
    email: e.email,
    name: e.name,
    active: e.active,
    canChooseAddress: e.canChooseAddress,
    canChangeTime: e.canChangeTime,
    canChangePackaging: e.canChangePackaging,
    company: { id: e.company.id, name: e.company.name },
    allergens: e.allergens.map((a) => ({ id: a.allergen.id, name: a.allergen.name })),
    dietaryTags: e.dietaryTags.map((t) => ({ id: t.dietaryTag.id, name: t.dietaryTag.name })),
  };
}

interface EmployeeFields {
  companyId?: number;
  email?: string;
  name?: string;
  active?: boolean;
  canChooseAddress?: boolean;
  canChangeTime?: boolean;
  canChangePackaging?: boolean;
  allergenIds?: number[];
  dietaryTagIds?: number[];
}

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: { page: number; pageSize: number; companyId?: number; search?: string }): Promise<Paged<unknown>> {
    const where: Prisma.EmployeeWhereInput = {
      companyId: q.companyId,
      OR: q.search
        ? [
            { name: { contains: q.search, mode: "insensitive" } },
            { email: { contains: q.search, mode: "insensitive" } },
          ]
        : undefined,
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.employee.findMany({
        where,
        include,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.employee.count({ where }),
    ]);
    return { items: rows.map(toEmployee), total };
  }

  async findOne(id: number) {
    const employee = await this.prisma.employee.findUnique({ where: { id }, include });
    if (!employee) throw new DomainError("NOT_FOUND", "Employee not found", 404);
    return toEmployee(employee);
  }

  async create(input: EmployeeFields & { companyId: number; email: string; name: string }) {
    await this.assertCompanyExists(input.companyId);
    await assertReferencesExist(this.prisma, input);
    await this.assertEmailFitsCompany(input.companyId, input.email);
    try {
      const employee = await this.prisma.employee.create({
        data: {
          companyId: input.companyId,
          email: input.email,
          name: input.name,
          active: input.active,
          canChooseAddress: input.canChooseAddress,
          canChangeTime: input.canChangeTime,
          canChangePackaging: input.canChangePackaging,
          allergens: { create: toJoinRows("allergenId", input.allergenIds ?? []) },
          dietaryTags: { create: toJoinRows("dietaryTagId", input.dietaryTagIds ?? []) },
        },
        include,
      });
      return toEmployee(employee);
    } catch (e) {
      throw this.translate(e);
    }
  }

  async update(id: number, input: EmployeeFields) {
    const current = await this.prisma.employee.findUnique({ where: { id } });
    if (!current) throw new DomainError("NOT_FOUND", "Employee not found", 404);

    const moving = input.companyId !== undefined && input.companyId !== current.companyId;
    if (input.companyId !== undefined) await this.assertCompanyExists(input.companyId);
    await assertReferencesExist(this.prisma, input);

    // The email must fit the company the employee ends up in (checked again after a move).
    if (moving || input.email !== undefined) {
      await this.assertEmailFitsCompany(input.companyId ?? current.companyId, input.email ?? current.email);
    }
    if (moving) {
      const owned = await this.prisma.company.findFirst({ where: { ownerEmployeeId: id } });
      if (owned) {
        throw new DomainError("OWNER_CANNOT_MOVE", `${owned.name} lists this person as its owner. Choose another owner first.`, 409);
      }
    }

    try {
      const employee = await this.prisma.employee.update({
        where: { id },
        data: {
          companyId: input.companyId,
          email: input.email,
          name: input.name,
          active: input.active,
          canChooseAddress: input.canChooseAddress,
          canChangeTime: input.canChangeTime,
          canChangePackaging: input.canChangePackaging,
          allergens: input.allergenIds ? { deleteMany: {}, create: toJoinRows("allergenId", input.allergenIds) } : undefined,
          dietaryTags: input.dietaryTagIds ? { deleteMany: {}, create: toJoinRows("dietaryTagId", input.dietaryTagIds) } : undefined,
        },
        include,
      });
      return toEmployee(employee);
    } catch (e) {
      throw this.translate(e);
    }
  }

  private async assertCompanyExists(companyId: number) {
    if (!(await this.prisma.company.findUnique({ where: { id: companyId } }))) {
      throw new DomainError("INVALID_REFERENCE", "That company does not exist", 400, { companyId: "That company does not exist" });
    }
  }

  // Every employee's email must be at one of their company's domains (spec 4.4/4.5).
  private async assertEmailFitsCompany(companyId: number, email: string) {
    const domains = (await this.prisma.companyDomain.findMany({ where: { companyId } })).map((d) => d.domain);
    const emailDomain = email.slice(email.lastIndexOf("@") + 1);
    if (!domains.includes(emailDomain)) {
      const message = `Use an email at one of the company's domains: ${domains.join(", ")}`;
      throw new DomainError("EMAIL_DOMAIN_MISMATCH", message, 400, { email: message });
    }
  }

  private translate(e: unknown): unknown {
    if (isUniqueViolation(e)) {
      return new DomainError("EMAIL_TAKEN", "Another employee already uses that email", 409, {
        email: "Another employee already uses that email",
      });
    }
    return e;
  }
}
