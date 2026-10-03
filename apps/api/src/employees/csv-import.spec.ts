import { DomainError } from "../common/domain-error";
import { parseEmployeeCsv, validateEmployeeRows, type ImportContext } from "./csv-import";

const ctx = (over: Partial<ImportContext> = {}): ImportContext => ({
  domains: ["acme.com"],
  existingEmails: new Set<string>(),
  allergens: new Map([["nuts", 1], ["dairy", 2]]),
  dietaryTags: new Map([["vegan", 10], ["jain", 11]]),
  ...over,
});
const run = (csv: string, c = ctx()) => validateEmployeeRows(parseEmployeeCsv(csv), c);

describe("parseEmployeeCsv", () => {
  it("reads a header and rows, case-insensitively and ignoring spaces around values", () => {
    const rows = parseEmployeeCsv("Name , EMAIL\n Asha Rao , asha@acme.com \n");
    expect(rows).toEqual([{ row: 1, values: { name: "Asha Rao", email: "asha@acme.com" } }]);
  });

  it("handles quoted commas, Windows line endings, a byte-order mark and blank lines", () => {
    const csv = "﻿name,email\r\n\"Rao, Asha\",asha@acme.com\r\n\r\nBen,ben@acme.com\r\n";
    const rows = parseEmployeeCsv(csv);
    expect(rows.map((r) => r.values.name)).toEqual(["Rao, Asha", "Ben"]);
    expect(rows.map((r) => r.row)).toEqual([1, 2]);
  });

  it.each([
    ["an empty file", ""],
    ["only a header", "name,email\n"],
  ])("refuses %s", (_label, csv) => {
    expect(() => parseEmployeeCsv(csv)).toThrow(DomainError);
  });

  it("refuses a file without the required columns, naming what is missing", () => {
    expect(() => parseEmployeeCsv("name\nAsha\n")).toThrow(/email/);
    expect(() => parseEmployeeCsv("email\na@acme.com\n")).toThrow(/name/);
  });

  it("refuses unknown columns (a typo such as 'emial' should not be silently ignored)", () => {
    expect(() => parseEmployeeCsv("name,emial,email\nA,a,a@acme.com\n")).toThrow(/emial/);
  });

  it("refuses a repeated column and a malformed file", () => {
    expect(() => parseEmployeeCsv("name,name,email\nA,B,a@acme.com\n")).toThrow(/more than once/);
    expect(() => parseEmployeeCsv('name,email\n"Asha,asha@acme.com\n')).toThrow(DomainError);
  });

  it("refuses more than 1000 rows", () => {
    const rows = Array.from({ length: 1001 }, (_, i) => `P${i},p${i}@acme.com`).join("\n");
    expect(() => parseEmployeeCsv(`name,email\n${rows}\n`)).toThrow(/1000/);
  });
});

describe("validateEmployeeRows", () => {
  it("accepts good rows and lower-cases the email", () => {
    const { valid, errors } = run("name,email\nAsha Rao,ASHA@Acme.com\n");
    expect(errors).toEqual([]);
    expect(valid[0]).toMatchObject({ row: 1, name: "Asha Rao", email: "asha@acme.com", canChooseAddress: false, canChangeTime: false, canChangePackaging: false, allergenIds: [], dietaryTagIds: [] });
  });

  it("reads the optional permission flags (true/false, yes/no, 1/0, any case)", () => {
    const { valid, errors } = run("name,email,canChooseAddress,canChangeTime,canChangePackaging\nA,a@acme.com,YES,0,True\n");
    expect(errors).toEqual([]);
    expect(valid[0]).toMatchObject({ canChooseAddress: true, canChangeTime: false, canChangePackaging: true });
  });

  it("looks up allergies and dietary preferences by name, separated by semicolons", () => {
    const { valid, errors } = run("name,email,allergies,dietaryPreferences\nA,a@acme.com,Nuts; DAIRY,Vegan;Jain\n");
    expect(errors).toEqual([]);
    expect(valid[0].allergenIds.sort()).toEqual([1, 2]);
    expect(valid[0].dietaryTagIds.sort()).toEqual([10, 11]);
  });

  it("reports each bad row with its row number and a specific message, and keeps the good rows", () => {
    const csv = [
      "name,email,canChangeTime,allergies",
      "Good One,good@acme.com,,",
      ",noname@acme.com,,",
      "Bad Email,not-an-email,,",
      "Wrong Domain,x@other.com,,",
      "Maybe,m@acme.com,perhaps,",
      "Allergic,al@acme.com,,Pollen",
      "Last Good,last@acme.com,,",
    ].join("\n");
    const { valid, errors } = run(csv);
    expect(valid.map((v) => v.row)).toEqual([1, 6 + 1]);
    expect(errors.map((e) => e.row)).toEqual([2, 3, 4, 5, 6]);
    expect(errors[0].message).toMatch(/name/i);
    expect(errors[1].message).toMatch(/email/i);
    expect(errors[2].message).toMatch(/acme\.com/);
    expect(errors[3].message).toMatch(/canChangeTime/i);
    expect(errors[4].message).toMatch(/Pollen/);
    expect(errors[2]).toMatchObject({ name: "Wrong Domain", email: "x@other.com" });
  });

  it("refuses an email that already exists, or that appears twice in the file (the first one wins)", () => {
    const { valid, errors } = run("name,email\nA,taken@acme.com\nB,new@acme.com\nC,NEW@acme.com\n", ctx({ existingEmails: new Set(["taken@acme.com"]) }));
    expect(valid.map((v) => v.email)).toEqual(["new@acme.com"]);
    expect(errors.map((e) => e.row)).toEqual([1, 3]);
    expect(errors[0].message).toMatch(/already/i);
    expect(errors[1].message).toMatch(/row 2/i);
  });

  it("collects several problems of one row into one message", () => {
    const { errors } = run("name,email,canChangeTime\n,bad,perhaps\n");
    expect(errors).toHaveLength(1);
    expect(errors[0].message.split(";").length).toBeGreaterThanOrEqual(3);
  });

  it("a name that is too long is refused", () => {
    const { errors } = run(`name,email\n${"x".repeat(121)},a@acme.com\n`);
    expect(errors[0].message).toMatch(/120/);
  });
});
