import { z } from "zod";

export const LoginInput = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export const CreateStaffInput = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  name: z.string().trim().min(1, "Name is required"),
  password: z.string().min(8, "Use at least 8 characters"),
  roleId: z.number().int().positive(),
});

export const UpdateStaffInput = z.object({
  name: z.string().trim().min(1).optional(),
  roleId: z.number().int().positive().optional(),
  active: z.boolean().optional(),
  password: z.string().min(8, "Use at least 8 characters").optional(),
});

// What GET /auth/me returns; the web app builds its menu from `permissions`.
export interface Me {
  id: number;
  email: string;
  name: string;
  role: string;
  permissions: string[];
}
