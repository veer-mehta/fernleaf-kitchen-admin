import type { NextFunction, Request, Response } from "express";
import { DomainError } from "./domain-error";

const READ_ONLY = new Set(["GET", "HEAD", "OPTIONS"]);

// CSRF defence in depth on top of the SameSite=Lax cookie: a browser always sends the Origin
// header on a cross-site write, so a write whose Origin is not our web app is refused.
// No Origin header means a non-browser client (curl, the e2e tests), which CSRF cannot use.
// The allowed address is read per request so it follows the environment, as the CORS setting does.
export function originCheck(req: Request, _res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  if (READ_ONLY.has(req.method) || origin === undefined || origin === process.env.WEB_ORIGIN) return next();
  throw new DomainError("BAD_ORIGIN", "Requests from this origin are not allowed", 403);
}
