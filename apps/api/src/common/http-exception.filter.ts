import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import { ZodValidationException } from "nestjs-zod";
import type { Response } from "express";
import type { ZodError } from "zod";
import type { ApiError } from "@fernleaf/shared";
import { DomainError } from "./domain-error";

// @Catch() with no argument catches everything, so every error leaves the API in one shape.
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.toResponse(exception);
    res.status(status).json(body);
  }

  private toResponse(exception: unknown): { status: number; body: ApiError } {
    if (exception instanceof DomainError) {
      const body: ApiError = { code: exception.code, message: exception.message };
      if (exception.fields) body.fields = exception.fields;
      return { status: exception.status, body };
    }

    // Must be checked before HttpException: ZodValidationException extends it.
    if (exception instanceof ZodValidationException) {
      const fields: Record<string, string> = {};
      // nestjs-zod types this as unknown; it is always a ZodError.
      const zodError = exception.getZodError() as ZodError;
      for (const issue of zodError.issues) {
        const key = issue.path.join(".") || "_";
        if (!(key in fields)) fields[key] = issue.message; // keep the first message per field
      }
      return {
        status: 400,
        body: { code: "VALIDATION_ERROR", message: "Some fields are invalid", fields },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return { status, body: { code: `HTTP_${status}`, message: exception.message } };
    }

    // Unknown error: log the detail, never send it to the client.
    this.logger.error(exception);
    return { status: 500, body: { code: "INTERNAL_ERROR", message: "Something went wrong" } };
  }
}
