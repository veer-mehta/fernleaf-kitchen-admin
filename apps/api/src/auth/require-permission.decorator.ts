import { SetMetadata } from "@nestjs/common";

export const PERMISSION_KEY = "requiredPermission";
export const AUTHENTICATED_KEY = "authenticatedOnly";

// The route needs a logged-in user whose role holds this permission code.
export const RequirePermission = (code: string) => SetMetadata(PERMISSION_KEY, code);

// The route needs only a valid login, no particular permission (e.g. /auth/me).
export const Authenticated = () => SetMetadata(AUTHENTICATED_KEY, true);
