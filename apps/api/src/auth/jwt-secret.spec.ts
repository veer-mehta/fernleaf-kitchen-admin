import { readJwtSecret } from "./jwt-secret";

describe("readJwtSecret", () => {
  it("refuses to start without a secret", () => {
    expect(() => readJwtSecret({})).toThrow("JWT_SECRET is not set");
  });

  it("accepts any secret outside production, so local setup stays easy", () => {
    expect(readJwtSecret({ JWT_SECRET: "change-me" })).toBe("change-me");
  });

  it("refuses the example value in production", () => {
    expect(() => readJwtSecret({ NODE_ENV: "production", JWT_SECRET: "change-me" })).toThrow("JWT_SECRET");
  });

  it("refuses a short secret in production", () => {
    expect(() => readJwtSecret({ NODE_ENV: "production", JWT_SECRET: "short" })).toThrow("JWT_SECRET");
  });

  it("accepts a long random secret in production", () => {
    const secret = "x".repeat(32);
    expect(readJwtSecret({ NODE_ENV: "production", JWT_SECRET: secret })).toBe(secret);
  });
});
