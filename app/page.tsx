"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function Home() {
  const router = useRouter();
  const [msg, setMsg] = useState("Loading…");

  useEffect(() => {
    const hash = window.location.hash || "";

    // ✅ If this is a Supabase recovery link, forward to reset page
    if (hash.includes("access_token=") && hash.includes("type=recovery")) {
      router.replace(`/reset-password${hash}`);
      return;
    }

    // Otherwise route normally based on session
    (async () => {
      const { data } = await supabase.auth.getSession();
      const session = data.session;

      if (session) {
        router.replace("/hub");
      } else {
        router.replace("/login");
      }
    })();
  }, [router]);

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-gray-50 p-6 text-black">
      <div className="rounded-2xl border bg-white p-6 text-sm">{msg}</div>
    </div>
  );
}