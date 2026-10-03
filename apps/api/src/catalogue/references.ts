import { DomainError } from "../common/domain-error";
import { PrismaService } from "../prisma/prisma.service";

interface Refs {
  allergenIds?: number[];
  dietaryTagIds?: number[];
  portionSizeIds?: number[];
  stationId?: number | null;
}

// Checks that the allergens, dietary tags and station a request points at really exist, and
// reports every problem at once as field errors (instead of a raw foreign-key database error).
export async function assertReferencesExist(prisma: PrismaService, refs: Refs) {
  const fields: Record<string, string> = {};

  if (refs.allergenIds?.length) {
    const ids = [...new Set(refs.allergenIds)];
    if ((await prisma.allergen.count({ where: { id: { in: ids } } })) !== ids.length) {
      fields.allergenIds = "One of the allergens does not exist";
    }
  }
  if (refs.dietaryTagIds?.length) {
    const ids = [...new Set(refs.dietaryTagIds)];
    if ((await prisma.dietaryTag.count({ where: { id: { in: ids } } })) !== ids.length) {
      fields.dietaryTagIds = "One of the dietary tags does not exist";
    }
  }
  if (refs.portionSizeIds?.length) {
    const ids = [...new Set(refs.portionSizeIds)];
    if ((await prisma.portionSize.count({ where: { id: { in: ids } } })) !== ids.length) {
      fields.portionSizeIds = "One of the sizes does not exist";
    }
  }
  if (refs.stationId) {
    if (!(await prisma.kitchenStation.findUnique({ where: { id: refs.stationId } }))) {
      fields.stationId = "That kitchen station does not exist";
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new DomainError("INVALID_REFERENCE", "Some selected items do not exist", 400, fields);
  }
}

// `[1, 1, 2]` -> `[{ allergenId: 1 }, { allergenId: 2 }]`, ready for a Prisma nested create.
export const toJoinRows = <K extends string>(key: K, ids: number[]) =>
  [...new Set(ids)].map((id) => ({ [key]: id }) as Record<K, number>);
