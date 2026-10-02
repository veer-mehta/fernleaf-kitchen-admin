import { ArgumentsHost, BadRequestException } from "@nestjs/common";
import { ZodError } from "zod";
import { ZodValidationException } from "nestjs-zod";
import { DomainError } from "./domain-error";
import { HttpExceptionFilter } from "./http-exception.filter";

// A minimal stand-in for Express's response, so we can see what the filter sends.
function run(exception: unknown) {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
  new HttpExceptionFilter().catch(exception, host);
  return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
}

describe("HttpExceptionFilter", () => {
  it("maps DomainError to {code, message} with its status", () => {
    const { status, body } = run(new DomainError("ORDER_LOCKED", "Locked", 409));
    expect(status).toBe(409);
    expect(body).toEqual({ code: "ORDER_LOCKED", message: "Locked" });
  });

  it("includes fields when the DomainError has them", () => {
    const { body } = run(new DomainError("BAD", "Bad", 400, { sku: "Already used" }));
    expect(body.fields).toEqual({ sku: "Already used" });
  });

  it("maps a zod failure to VALIDATION_ERROR with a fields map", () => {
    const zodError = new ZodError([{ code: "custom", path: ["email"], message: "Invalid email" }]);
    const { status, body } = run(new ZodValidationException(zodError));
    expect(status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.fields).toEqual({ email: "Invalid email" });
  });

  it("maps other Nest HttpExceptions", () => {
    const { status, body } = run(new BadRequestException("nope"));
    expect(status).toBe(400);
    expect(body).toEqual({ code: "HTTP_400", message: "nope" });
  });

  it("hides details of unknown errors behind a 500", () => {
    const { status, body } = run(new Error("db password is hunter2"));
    expect(status).toBe(500);
    expect(body).toEqual({ code: "INTERNAL_ERROR", message: "Something went wrong" });
  });
});
