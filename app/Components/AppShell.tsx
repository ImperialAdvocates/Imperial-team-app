"use client";

import { usePathname } from "next/navigation";
import BottomTabs from "./bottomtabs/BottomTabs"; // adjust if your path/case differs

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const isAuth =
    pathname?.startsWith("/login") ||
    pathname?.startsWith("/signup") ||
    pathname?.startsWith("/auth");

  const isAdmin = pathname?.startsWith("/admin");

  const showTabs = !isAuth && !isAdmin;

  return (
    <div className="min-h-dvh bg-gray-50 text-black">
      {/* Only reserve bottom space when tabs are visible */}
      <main className={`mx-auto max-w-[520px] px-4 py-4 ${showTabs ? "pb-24" : "pb-4"}`}>
        {children}
      </main>

      {showTabs ? <BottomTabs /> : null}
    </div>
  );
}