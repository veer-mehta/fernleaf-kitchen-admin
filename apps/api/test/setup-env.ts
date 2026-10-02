import { config } from "dotenv";
import { resolve } from "path";

// Load the repo-root .env, then point Prisma at the separate test database
// so tests can never touch development data.
config({ path: resolve(__dirname, "../../../.env"), quiet: true });
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret";
