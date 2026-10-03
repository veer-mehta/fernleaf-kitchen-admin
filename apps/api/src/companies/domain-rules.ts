import { DomainError } from "../common/domain-error";
import { PrismaService } from "../prisma/prisma.service";
import { PUBLIC_DOMAINS } from "./public-domains";

// Checks a list of (already lower-cased) domains a company wants to claim:
// no free-mail providers, no repeats in the request, and not already owned by another company.
// `field` is the form field the message is attached to ("domains" when creating, "domain" when adding one).
export async function assertDomainsClaimable(prisma: PrismaService, domains: string[], field: string) {
  const isPublic = domains.filter((d) => PUBLIC_DOMAINS.has(d));
  if (isPublic.length > 0) {
    throw new DomainError("PUBLIC_DOMAIN", `${isPublic.join(", ")} is a public email domain and cannot be claimed`, 400, {
      [field]: `${isPublic.join(", ")} is a public email domain and cannot be claimed`,
    });
  }

  if (new Set(domains).size !== domains.length) {
    throw new DomainError("DUPLICATE_DOMAIN", "A domain is listed twice", 400, { [field]: "A domain is listed twice" });
  }

  const taken = await prisma.companyDomain.findMany({ where: { domain: { in: domains } } });
  if (taken.length > 0) {
    const names = taken.map((t) => t.domain).join(", ");
    throw new DomainError("DOMAIN_TAKEN", `${names} already belongs to a company`, 409, {
      [field]: `${names} already belongs to a company`,
    });
  }
}
