import { parse } from "csv-parse/sync";
import { DomainError } from "../common/domain-error";

// ---------------------------------------------------------------------------------------------
// Bulk import of a company's employees from a CSV file.
//
// Two steps, both free of database calls so they are easy to test:
//   1. parseEmployeeCsv  - reads the text. A broken FILE (no header, unknown column, too big) is
//                          refused as a whole.
//   2. validateEmployeeRows - checks each ROW. A bad row is reported with its number and a message
//                          and the good rows are still imported.
// ---------------------------------------------------------------------------------------------

export const MAX_ROWS = 1000;

// The columns, as people may type them -> the name used inside the program.
// Headers are compared ignoring case, spaces and underscores ("Can change time" works too).
const COLUMNS = {
  name: "name",
  email: "email",
  canchooseaddress: "canChooseAddress",
  canchangetime: "canChangeTime",
  canchangepackaging: "canChangePackaging",
  allergies: "allergies",
  dietarypreferences: "dietaryPreferences",
} as const;
type Column = (typeof COLUMNS)[keyof typeof COLUMNS];
const squash = (header: string) => header.toLowerCase().replace(/[\s_]/g, "");

export interface RawRow {
  row: number; // 1 = the first employee row after the header
  values: Partial<Record<Column, string>>;
}

const badFile = (message: string) => new DomainError("INVALID_CSV", message, 400, { csv: message });

export function parseEmployeeCsv(text: string): RawRow[] {
  let table: string[][];
  try {
    table = parse(text, { bom: true, skip_empty_lines: true, trim: true, relax_column_count: true });
  } catch (e) {
    throw badFile(`The file could not be read as CSV (${e instanceof Error ? e.message : "malformed"})`);
  }
  if (table.length === 0) throw badFile("The file is empty. The first line must list the columns, e.g. name,email");

  // ---- header ----
  const header = table[0].map((h) => squash(h));
  const unknown = table[0].filter((_, i) => !(header[i] in COLUMNS));
  if (unknown.length > 0) {
    throw badFile(`Unknown column(s): ${unknown.join(", ")}. Allowed: name, email, canChooseAddress, canChangeTime, canChangePackaging, allergies, dietaryPreferences`);
  }
  if (new Set(header).size !== header.length) throw badFile("A column appears more than once");
  const missing = (["name", "email"] as const).filter((c) => !header.includes(c));
  if (missing.length > 0) throw badFile(`Missing required column(s): ${missing.join(", ")}`);

  // ---- rows ----
  const body = table.slice(1).filter((cells) => cells.some((c) => c !== "")); // a row of only commas is blank
  if (body.length === 0) throw badFile("The file has a header but no employees");
  if (body.length > MAX_ROWS) throw badFile(`The file has ${body.length} rows; the limit is ${MAX_ROWS}. Split it into smaller files.`);

  return body.map((cells, i) => {
    const values: RawRow["values"] = {};
    header.forEach((h, c) => {
      values[COLUMNS[h as keyof typeof COLUMNS]] = cells[c] ?? "";
    });
    return { row: i + 1, values };
  });
}

// What the validator needs to know about the company and the database.
export interface ImportContext {
  domains: string[]; // the company's email domains
  existingEmails: Set<string>; // every employee email already in the system (lower-case)
  allergens: Map<string, number>; // lower-case name -> id
  dietaryTags: Map<string, number>;
}
export interface ValidRow {
  row: number;
  name: string;
  email: string;
  canChooseAddress: boolean;
  canChangeTime: boolean;
  canChangePackaging: boolean;
  allergenIds: number[];
  dietaryTagIds: number[];
}
export interface RowError {
  row: number;
  name: string;
  email: string;
  message: string;
}

const TRUE = new Set(["true", "yes", "y", "1"]);
const FALSE = new Set(["false", "no", "n", "0", ""]);

export function validateEmployeeRows(rows: RawRow[], ctx: ImportContext): { valid: ValidRow[]; errors: RowError[] } {
  const valid: ValidRow[] = [];
  const errors: RowError[] = [];
  const seenInFile = new Map<string, number>(); // email -> the row that used it first

  for (const { row, values } of rows) {
    const problems: string[] = [];
    const name = (values.name ?? "").trim();
    const email = (values.email ?? "").trim().toLowerCase();

    if (!name) problems.push("Name is required");
    else if (name.length > 120) problems.push("Name must be 120 characters or fewer");

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      problems.push("Email is not valid");
    } else {
      const domain = email.slice(email.lastIndexOf("@") + 1);
      if (!ctx.domains.includes(domain)) problems.push(`Email must be at one of the company's domains (${ctx.domains.join(", ")})`);
      else if (ctx.existingEmails.has(email)) problems.push("That email already belongs to an employee");
      else if (seenInFile.has(email)) problems.push(`The same email appears earlier in the file (row ${seenInFile.get(email)})`);
    }

    const flag = (column: "canChooseAddress" | "canChangeTime" | "canChangePackaging") => {
      const text = (values[column] ?? "").trim().toLowerCase();
      if (TRUE.has(text)) return true;
      if (FALSE.has(text)) return false;
      problems.push(`${column} must be yes or no (got "${values[column]}")`);
      return false;
    };
    const canChooseAddress = flag("canChooseAddress");
    const canChangeTime = flag("canChangeTime");
    const canChangePackaging = flag("canChangePackaging");

    const lookup = (column: "allergies" | "dietaryPreferences", known: Map<string, number>, noun: string) => {
      const ids: number[] = [];
      for (const part of (values[column] ?? "").split(";").map((p) => p.trim()).filter(Boolean)) {
        const id = known.get(part.toLowerCase());
        if (id === undefined) problems.push(`Unknown ${noun}: ${part}`);
        else if (!ids.includes(id)) ids.push(id);
      }
      return ids;
    };
    const allergenIds = lookup("allergies", ctx.allergens, "allergy");
    const dietaryTagIds = lookup("dietaryPreferences", ctx.dietaryTags, "dietary preference");

    if (problems.length > 0) {
      errors.push({ row, name, email, message: problems.join("; ") });
    } else {
      seenInFile.set(email, row);
      valid.push({ row, name, email, canChooseAddress, canChangeTime, canChangePackaging, allergenIds, dietaryTagIds });
    }
  }
  return { valid, errors };
}
