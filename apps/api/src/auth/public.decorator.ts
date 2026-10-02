import { SetMetadata } from "@nestjs/common";

export const PUBLIC_KEY = "isPublic";
// Marks a route that needs no login (login, health).
export const Public = () => SetMetadata(PUBLIC_KEY, true);
