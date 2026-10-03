import { z } from "zod";
import { PageQuery } from "./pagination";
import { isoDate } from "./settings";

const id = z.number().int().positive();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use the 24-hour format HH:mm");
const workingDays = z
  .array(z.number().int().min(1).max(7))
  .min(1, "Pick at least one working day")
  .refine((d) => new Set(d).size === d.length, "Each day can only be listed once");

export const PACKAGING = ["STANDARD", "ECO", "INSULATED"] as const;

// Text typed for a domain: trims, lower-cases and drops a leading "@" ("@Acme.com" -> "acme.com").
const domain = z
  .string()
  .transform((s) => s.trim().toLowerCase().replace(/^@/, ""))
  .refine((s) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s), "Enter a domain like acme.com");

export const AddressInput = z.object({
  label: z.string().trim().min(1, "Give the address a name").max(80),
  line1: z.string().trim().min(1, "Address line is required").max(200),
  line2: z.string().trim().max(200).default(""),
  city: z.string().trim().min(1, "City is required").max(80),
  postalCode: z.string().trim().min(1, "Postal code is required").max(20),
  instructions: z.string().trim().max(500).default(""),
});

const companyFields = {
  name: z.string().trim().min(1, "Name is required").max(120),
  priceTierId: id.nullable(),
  billingContactName: z.string().trim().max(120),
  billingContactEmail: z.string().trim().max(200),
  billingContactPhone: z.string().trim().max(40),
  workingDays,
  deliveryTime: time,
  deliveryMinutes: z.number().int().min(0).max(600),
  defaultPackaging: z.enum(PACKAGING),
  driverInstructions: z.string().trim().max(1000),
  defaultDriverId: id.nullable(),
};

export const CompanyInput = z.object({
  name: companyFields.name,
  priceTierId: companyFields.priceTierId.default(null),
  billingContactName: companyFields.billingContactName.default(""),
  billingContactEmail: companyFields.billingContactEmail.default(""),
  billingContactPhone: companyFields.billingContactPhone.default(""),
  workingDays: companyFields.workingDays.default([1, 2, 3, 4, 5]),
  deliveryTime: companyFields.deliveryTime.default("13:00"),
  deliveryMinutes: companyFields.deliveryMinutes.default(60),
  defaultPackaging: companyFields.defaultPackaging.default("STANDARD"),
  driverInstructions: companyFields.driverInstructions.default(""),
  defaultDriverId: companyFields.defaultDriverId.default(null),
  domains: z.array(domain).min(1, "Add at least one email domain"),
  addresses: z.array(AddressInput).min(1, "Add at least one delivery address"),
});

// For PATCH every field is optional (and there are no defaults, so nothing is reset by accident).
export const UpdateCompanyInput = z
  .object({ ...companyFields, ownerEmployeeId: id.nullable() })
  .partial();

export const DomainInput = z.object({ domain });
export const CompanyHolidayInput = z.object({
  date: isoDate,
  name: z.string().trim().max(80).default(""),
});
export const HiddenInput = z.object({
  categoryIds: z.array(id),
  dishIds: z.array(id),
});

export const CompanyListQuery = PageQuery.extend({ search: z.string().trim().optional() });

const email = z.string().trim().toLowerCase().email("Enter a valid email");
const employeeFields = {
  companyId: id,
  email,
  name: z.string().trim().min(1, "Name is required").max(120),
  active: z.boolean(),
  canChooseAddress: z.boolean(),
  canChangeTime: z.boolean(),
  canChangePackaging: z.boolean(),
  allergenIds: z.array(id),
  dietaryTagIds: z.array(id),
};
export const EmployeeInput = z.object({
  ...employeeFields,
  active: employeeFields.active.default(true),
  canChooseAddress: employeeFields.canChooseAddress.default(false),
  canChangeTime: employeeFields.canChangeTime.default(false),
  canChangePackaging: employeeFields.canChangePackaging.default(false),
  allergenIds: employeeFields.allergenIds.default([]),
  dietaryTagIds: employeeFields.dietaryTagIds.default([]),
});
export const UpdateEmployeeInput = z.object(employeeFields).partial();
export const EmployeeListQuery = PageQuery.extend({
  companyId: z.coerce.number().int().positive().optional(),
  search: z.string().trim().optional(),
});

// For PATCH of one address: every field optional, no defaults.
export const UpdateAddressInput = z
  .object({
    label: z.string().trim().min(1).max(80),
    line1: z.string().trim().min(1).max(200),
    line2: z.string().trim().max(200),
    city: z.string().trim().min(1).max(80),
    postalCode: z.string().trim().min(1).max(20),
    instructions: z.string().trim().max(500),
  })
  .partial();
