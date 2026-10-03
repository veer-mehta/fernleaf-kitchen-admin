// Refuse to start without a secret rather than sign tokens with a guessable one.
// In production the example value from .env.example and short secrets are rejected too.
export function readJwtSecret(env: Record<string, string | undefined>): string {
  const secret = env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  if (env.NODE_ENV === "production" && (secret === "change-me" || secret.length < 16)) {
    throw new Error("JWT_SECRET must be a random value of at least 16 characters in production");
  }
  return secret;
}
