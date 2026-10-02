module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  testRegex: "(src|test)/.*\\.(spec|e2e-spec)\\.ts$",
  setupFiles: ["<rootDir>/test/setup-env.ts"],
  // DB tests share one Postgres database, so run test files one after another.
  maxWorkers: 1,
};
