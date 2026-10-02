"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { NAV_ITEMS } from "@/components/nav-items";
import { apiPost } from "@/lib/api";
import { ME_KEY, useMe } from "@/lib/auth";

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const { me, can, isLoading } = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  // Not signed in: send to the login page once we know for sure.
  useEffect(() => {
    if (!isLoading && !me) router.replace("/login");
  }, [isLoading, me, router]);

  if (isLoading || !me) return <p className="p-6 text-muted-foreground">Loading…</p>;

  async function logout() {
    await apiPost("/auth/logout");
    queryClient.setQueryData(ME_KEY, null);
    router.replace("/login");
  }

  const items = NAV_ITEMS.filter((item) => !item.permission || can(item.permission));

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b p-4 md:w-56 md:border-b-0 md:border-r">
        <p className="font-semibold">Fernleaf Kitchen</p>
        <p className="mb-4 text-sm text-muted-foreground">
          {me.name} · {me.role}
        </p>
        <nav className="flex gap-2 md:flex-col">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded px-2 py-1 text-sm hover:bg-muted ${pathname === item.href ? "bg-muted font-medium" : ""}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <Button variant="outline" size="sm" className="mt-4" onClick={logout}>
          Sign out
        </Button>
      </aside>
      <main className="flex-1 p-4 md:p-6">{children}</main>
    </div>
  );
}
