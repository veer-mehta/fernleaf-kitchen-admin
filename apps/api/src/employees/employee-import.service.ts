import { Injectable } from "@nestjs/common";
import { DomainError } from "../common/domain-error";
import { isUniqueViolation } from "../common/prisma-errors";
import { PrismaService } from "../prisma/prisma.service";
import { parseEmployeeCsv, validateEmployeeRows } from "./csv-import";

@Injectable()
export class EmployeeImportService {
  constructor(private readonly prisma: PrismaService) {}

  // Imports a company's employees from CSV text. The file is refused as a whole only if it is
  // structurally broken; otherwise every valid row is created and every invalid row is reported.
  async import(companyId: number, csv: string) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, include: { domains: true } });
    if (!company) throw new DomainError("NOT_FOUND", "Company not found", 404);

    const rows = parseEmployeeCsv(csv);

    // What the validator must compare against: emails already taken, and the known allergies and tags.
    const emails = rows.map((r) => (r.values.email ?? "").trim().toLowerCase()).filter(Boolean);
    const [existing, allergens, tags] = await Promise.all([
      this.prisma.employee.findMany({ where: { email: { in: emails } }, select: { email: true } }),
      this.prisma.allergen.findMany(),
      this.prisma.dietaryTag.findMany(),
    ]);
    const { valid, errors } = validateEmployeeRows(rows, {
      domains: company.domains.map((d) => d.domain),
      existingEmails: new Set(existing.map((e) => e.email)),
      allergens: new Map(allergens.map((a) => [a.name.toLowerCase(), a.id])),
      dietaryTags: new Map(tags.map((t) => [t.name.toLowerCase(), t.id])),
    });

    try {
      // One transaction: either every valid row is created or (on an unexpected failure) none is.
      await this.prisma.$transaction(
        async (tx) => {
          for (const v of valid) {
            await tx.employee.create({
              data: {
                companyId, email: v.email, name: v.name,
                canChooseAddress: v.canChooseAddress, canChangeTime: v.canChangeTime, canChangePackaging: v.canChangePackaging,
                allergens: { create: v.allergenIds.map((allergenId) => ({ allergenId })) },
                dietaryTags: { create: v.dietaryTagIds.map((dietaryTagId) => ({ dietaryTagId })) },
              },
            });
          }
        },
        { timeout: 60_000 },
      );
    } catch (e) {
      // Someone created one of these emails between the check above and now: nothing was imported.
      if (isUniqueViolation(e)) throw new DomainError("EMAIL_TAKEN", "An email in the file was just taken by another employee. Nothing was imported; please try again.", 409);
      throw e;
    }

    return { total: rows.length, imported: valid.length, failed: errors.length, errors };
  }
}
