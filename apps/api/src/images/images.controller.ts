import { Controller, Get, Param, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { Authenticated } from "../auth/require-permission.decorator";
import { ImagesService } from "./images.service";

// Any signed-in staff member may upload and view: drivers attach delivery photos, admins dish
// pictures, and dispatch and admin see them. Nothing here can change an order or a dish by itself.
@Controller("images")
export class ImagesController {
  constructor(private readonly images: ImagesService) {}

  // The body is the raw file (see the express.raw middleware in AppModule), not JSON.
  @Post()
  @Authenticated()
  upload(@Req() req: Request) {
    return this.images.save(req.body);
  }

  // A non-numeric id is treated as "not found" rather than a validation error.
  @Get(":id")
  @Authenticated()
  async view(@Param("id") rawId: string, @Res() res: Response) {
    const id = /^\d+$/.test(rawId) ? Number(rawId) : 0;
    const image = await this.images.get(id);
    // Stored photos never change, so the browser may keep its copy; "private" keeps shared caches out.
    res.set({ "Content-Type": image.contentType, "Cache-Control": "private, max-age=86400, immutable" });
    res.send(Buffer.from(image.data));
  }
}
