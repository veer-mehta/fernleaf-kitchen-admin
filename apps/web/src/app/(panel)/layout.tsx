"use client";

import { useEffect, useState } from "react";
import { LogOut, Menu, PanelLeft } from "lucide-react";
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
  // Labels are hidden on a desktop when the sidebar is collapsed to its icon rail. (On a phone the
  // sidebar is a drawer that is either fully open or off-screen, so labels never need hiding there.)
  const hideLabel = sidebarOpen ? "" : "md:hidden";

  return (
    <div className="flex min-h-screen">
      {/* Phone only: tapping the dimmed page closes the drawer. */}
      {sidebarOpen && <div className="fixed inset-0 z-40 bg-black/40 md:hidden" aria-hidden onClick={() => setSidebarOpen(false)} />}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-background p-2 transition-transform md:sticky md:top-0 md:z-auto md:h-screen md:shrink-0 md:translate-x-0 md:transition-none ${sidebarOpen ? "translate-x-0 shadow-lg md:shadow-none" : "-translate-x-full"} ${sidebarOpen ? "md:w-56" : "md:w-14"}`}
      >
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"} aria-expanded={sidebarOpen} onClick={toggleSidebar}>
            <PanelLeft />
          </Button>
          <span className={`truncate font-semibold ${hideLabel}`}>Fernleaf Kitchen</span>
        </div>
        <p className={`mt-2 truncate px-2 text-sm text-muted-foreground ${hideLabel}`}>{me.name} · {me.role}</p>
        <nav className="mt-3 flex flex-1 flex-col gap-1 overflow-y-auto">
          {items.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                aria-label={item.label}
                onClick={() => isPhone() && setSidebarOpen(false)}
                className={`flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm hover:bg-muted ${active ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Icon className="size-4 shrink-0" />
                <span className={`truncate ${hideLabel}`}>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <Button variant="ghost" title="Sign out" aria-label="Sign out" className="mt-2 justify-start gap-3 px-2.5 text-muted-foreground" onClick={logout}>
          <LogOut className="size-4" />
          <span className={hideLabel}>Sign out</span>
        </Button>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phone only: a slim top bar with the menu button and the site name (a desktop has the sidebar instead). */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background px-3 md:hidden">
          <Button variant="ghost" size="icon" aria-label="Open menu" aria-expanded={sidebarOpen} onClick={toggleSidebar}>
            <Menu />
          </Button>
          <span className="font-semibold">Fernleaf Kitchen</span>
        </header>
        <main className="mx-auto w-full min-w-0 max-w-7xl flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
