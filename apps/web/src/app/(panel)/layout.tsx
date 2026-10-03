"use client";

import { useEffect, useState } from "react";
import { PanelLeft } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { NAV_ITEMS } from "@/components/nav-items";
import { apiPost } from "@/lib/api";
import { ME_KEY, useMe } from "@/lib/auth";

const isPhone = () => window.innerWidth < 768;

function readSidebarPreference(): boolean {
  if (typeof window === "undefined") return true;
  if (isPhone()) return false; // on a phone the menu is a drawer that starts closed
  try {
    const saved = localStorage.getItem("sidebar");
    if (saved) return saved === "open";
  } catch {} // storage can be blocked; the toggle still works
  return true;
}

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const { me, can, isLoading } = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  // The sidebar can be hidden to give pages the full width. On a desktop it stays fixed beside the page;
  // on a phone it is a drawer over the page.
  // (This component only renders its content after the user has loaded in the browser, so reading
  // localStorage in the initial state cannot cause a server/browser mismatch.)
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarPreference);
  function toggleSidebar() {
    const next = !sidebarOpen;
    setSidebarOpen(next);
    try {
      localStorage.setItem("sidebar", next ? "open" : "closed");
    } catch {}
  }

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
      {sidebarOpen && (
        <>
          {/* Phone only: tapping the dimmed page closes the drawer. */}
          <div className="fixed inset-0 z-40 bg-black/40 md:hidden" aria-hidden onClick={() => setSidebarOpen(false)} />
          <aside className="fixed inset-y-0 left-0 z-50 w-64 overflow-y-auto border-r bg-background p-4 shadow-lg md:sticky md:top-0 md:z-auto md:h-screen md:w-56 md:shrink-0 md:shadow-none">
            <p className="font-semibold">Fernleaf Kitchen</p>
            <p className="mb-4 text-sm text-muted-foreground">
              {me.name} · {me.role}
            </p>
            <nav className="flex flex-col gap-1">
              {items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => isPhone() && setSidebarOpen(false)}
                  className={`rounded px-2 py-1.5 text-sm hover:bg-muted ${pathname === item.href ? "bg-muted font-medium" : ""}`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <Button variant="outline" size="sm" className="mt-4" onClick={logout}>
              Sign out
            </Button>
          </aside>
        </>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b bg-background px-4 py-2">
          <Button variant="ghost" size="icon" aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"} aria-expanded={sidebarOpen} onClick={toggleSidebar}>
            <PanelLeft />
          </Button>
          <span className="text-sm font-medium">Fernleaf Kitchen</span>
        </header>
        {/* One centred container for every page, so they all share the same width. */}
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
