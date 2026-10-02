"use client";

import { useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet } from "@/lib/api";

interface StaffRow {
  id: number;
  email: string;
  name: string;
  active: boolean;
  role: { id: number; name: string };
}

// Read-only for now; Task 21 adds creating staff and changing roles.
export default function StaffPage() {
  const { data, error } = useQuery({ queryKey: ["staff"], queryFn: () => apiGet<StaffRow[]>("/staff") });

  if (error) return <p className="text-destructive">{error.message}</p>;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Staff</h1>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Active</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data?.map((s) => (
            <TableRow key={s.id}>
              <TableCell>{s.name}</TableCell>
              <TableCell>{s.email}</TableCell>
              <TableCell>{s.role.name}</TableCell>
              <TableCell>{s.active ? "Yes" : "No"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
