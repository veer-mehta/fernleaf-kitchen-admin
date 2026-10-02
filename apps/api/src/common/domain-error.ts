// Thrown by services for any business-rule failure. The filter turns it into
// the standard { code, message, fields? } JSON body.
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}
