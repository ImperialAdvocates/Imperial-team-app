"use client";

import { useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";

type Tab = {
  label: string;
  href: string;
  match?: (path: string) => boolean;
};

export default function BottomTabs() {
  const router = useRouter();
  const pathname = usePathname();

// Hide tabs on auth screens + admin
const hidden =
  pathname?.startsWith("/login") ||
  pathname?.startsWith("/signup") ||
  pathname?.startsWith("/auth") ||
  pathname?.startsWith("/admin");

  if (hidden) return null;

  const isAdminSection = pathname?.startsWith("/admin");

  const tabs: Tab[] = useMemo(() => {
    // ✅ Admin nav tabs
    if (isAdminSection) {
      return [
        {
          label: "Control",
          href: "/admin",
          match: (p) => p === "/admin",
        },
        {
          label: "Templates",
          href: "/admin/kpi-templates",
          match: (p) => p.startsWith("/admin/kpi-templates"),
        },
        {
          label: "Targets",
          href: "/admin/kpi-targets",
          match: (p) => p.startsWith("/admin/kpi-targets"),
        },
        {
          label: "Back",
          href: "/hub",
          match: (p) => p === "/hub" || p === "/",
        },
      ];
    }

    // ✅ Normal app nav tabs
    return [
      {
        label: "Hub",
        href: "/hub",
        match: (p) => p === "/hub" || p === "/",
      },
      {
        label: "Meetings",
        href: "/meetings",
        match: (p) => p.startsWith("/meetings"),
      },
      {
        label: "Hot Leads",
        href: "/hot-leads",
        match: (p) => p.startsWith("/hot-leads"),
      },
      {
        label: "KPIs",
        href: "/daily-kpis",
match: (p) => p.startsWith("/daily-kpis"),
      },
    ];
  }, [isAdminSection]);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-white">
      {/* safe area for iPhones */}
      <div className="pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto max-w-[520px] px-3">
          <div className="grid grid-cols-4 gap-2 py-2">
            {tabs.map((t) => {
              const active = t.match ? t.match(pathname) : pathname === t.href;

              return (
                <button
                  key={t.href}
                  onClick={() => router.push(t.href)}
                  className={[
                    "rounded-2xl px-2 py-2 text-xs",
                    "transition",
                    active
                      ? "bg-black text-white"
                      : "bg-white text-black border border-black/10",
                  ].join(" ")}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}