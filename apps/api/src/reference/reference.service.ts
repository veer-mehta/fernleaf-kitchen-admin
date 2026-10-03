import { Injectable } from "@nestjs/common";
import { DomainError } from "../common/domain-error";
import { isForeignKeyViolation, isRecordNotFound, isUniqueViolation } from "../common/prisma-errors";
import { PrismaService } from "../prisma/prisma.service";

interface Named {
  id: number;
  name: string;
}

// The four lists are all "id + unique name", so one service handles them. This is the
// subset of Prisma's model API we use; every one of the four delegates provides it.
interface NamedDelegate {
  findMany(args: { orderBy: { name: "asc" } }): Promise<Named[]>;
  create(args: { data: { name: string } }): Promise<Named>;
  update(args: { where: { id: number }; data: { name: string } }): Promise<Named>;
  delete(args: { where: { id: number } }): Promise<Named>;
}

@Injectable()
export class ReferenceService {
  constructor(private readonly prisma: PrismaService) {}

  private delegate(kind: string): NamedDelegate {
    // The cast is safe: each model has exactly the id and name fields described above.
    switch (kind) {
      case "allergens":
        return this.prisma.allergen as unknown as NamedDelegate;
      case "dietary-tags":
        return this.prisma.dietaryTag as unknown as NamedDelegate;
      case "stations":
        return this.prisma.kitchenStation as unknown as NamedDelegate;
      case "portion-sizes":
        return this.prisma.portionSize as unknown as NamedDelegate;
      default:
        throw new DomainError("NOT_FOUND", "Unknown list", 404);
    }
  }

  list(kind: string) {
    return this.delegate(kind).findMany({ orderBy: { name: "asc" } });
  }

  async create(kind: string, name: string) {
    try {
      return await this.delegate(kind).create({ data: { name } });
    } catch (e) {
      throw this.translate(e);
    }
  }

  async update(kind: string, id: number, name: string) {
    try {
      return await this.delegate(kind).update({ where: { id }, data: { name } });
    } catch (e) {
      throw this.translate(e);
    }
  }

  async remove(kind: string, id: number) {
    try {
      await this.delegate(kind).delete({ where: { id } });
      return { ok: true };
    } catch (e) {
      throw this.translate(e);
    }
  }

  // Turn database errors into the API's error shape. Anything unexpected is rethrown as is.
  private translate(e: unknown): unknown {
    if (isUniqueViolation(e)) {
      return new DomainError("NAME_TAKEN", "That name already exists", 409, {
        name: "That name already exists",
      });
    }
    if (isRecordNotFound(e)) return new DomainError("NOT_FOUND", "Not found", 404);
    if (isForeignKeyViolation(e)) {
      return new DomainError("IN_USE", "It is used by a dish or option, so it cannot be deleted", 409);
    }
    return e;
  }
}
