"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

export default function ResetPasswordPage() {
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setMsg(null);
      setReady(false);

      try {
        const url = new URL(window.location.href);

        // 1) PKCE flow (?code=...)
        const code = url.searchParams.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw new Error(`Reset link invalid/expired: ${error.message}`);
        }

        // 2) Implicit flow can arrive in:
        //    - hash: #access_token=...&refresh_token=...&type=recovery
        //    - query: ?access_token=...&refresh_token=...&type=recovery
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const access_token =
          url.searchParams.get("access_token") || hashParams.get("access_token");
        const refresh_token =
          url.searchParams.get("refresh_token") || hashParams.get("refresh_token");

        if (access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({
            access_token,
            refresh_token,
          });
          if (error) throw new Error(`Reset link invalid/expired: ${error.message}`);

          // Clean URL so refresh doesn't lose state
          window.history.replaceState({}, document.title, "/reset-password");
        }

        // 3) Verify we now have a session
        const { data, error } = await supabase.auth.getSession();
        if (error) throw new Error(error.message);
        if (!data.session) throw new Error("Auth session missing! Please open the newest reset email link again.");

        if (!cancelled) setReady(true);
      } catch (e: any) {
        if (!cancelled) {
          setMsg(e?.message ?? "Reset link invalid/expired.");
          setReady(false);
        }
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleReset() {
    setLoading(true);
    setMsg(null);

    try {
      if (password.length < 6) throw new Error("Password must be at least 6 characters.");

      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw new Error(error.message);

      setMsg("Password updated. Redirecting to login…");

      // Optional: sign out after changing password
      await supabase.auth.signOut();

      setTimeout(() => router.push("/login"), 1200);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to update password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-black text-white p-6">
      <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-black p-6">
        <h1 className="text-xl font-semibold">Reset password</h1>

        <p className="mt-2 text-xs text-white/70">
          Enter a new password. If you see “session missing”, open the newest reset email link again.
        </p>

        <input
          type="password"
          placeholder="New password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-4 w-full rounded-xl border border-white/20 bg-white px-3 py-2 text-black"
          disabled={!ready}
        />

        <button
          onClick={handleReset}
          disabled={!ready || loading || password.length < 6}
          className="mt-4 w-full rounded-xl bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
        >
          {loading ? "Updating…" : "Update password"}
        </button>

        {msg && <div className="mt-3 text-xs text-white/80">{msg}</div>}
      </div>
    </div>
  );
}