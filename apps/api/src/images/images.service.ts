import { Injectable } from "@nestjs/common";
import { DomainError } from "../common/domain-error";
import { PrismaService } from "../prisma/prisma.service";
import { detectImageType } from "./image-type";

@Injectable()
export class ImagesService {
  constructor(private readonly prisma: PrismaService) {}

  async save(data: unknown): Promise<{ url: string }> {
    // Anything that is not raw bytes (a JSON body, nothing at all) is not an image.
    if (!Buffer.isBuffer(data) || data.length === 0) throw invalid();
    const contentType = detectImageType(data);
    if (!contentType) throw invalid();
    const image = await this.prisma.storedImage.create({ data: { contentType, data: new Uint8Array(data) }, select: { id: true } });
    return { url: `/images/${image.id}` };
  }

  async get(id: number) {
    const image = await this.prisma.storedImage.findUnique({ where: { id } });
    if (!image) throw new DomainError("NOT_FOUND", "Image not found", 404);
    return image;
  }
}

const invalid = () => new DomainError("INVALID_IMAGE", "Upload a JPEG, PNG or WebP image", 400);
