"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ProfileRow = {
  id: string;
  full_name: string | null;
  role?: string | null;
};

function normRole(r?: string | null) {
  return (r ?? "").trim().toLowerCase();
}

export default function ProfilePage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [userId, setUserId] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [profile, setProfile] = useState<ProfileRow | null>(null);

  // delete confirm UI
  const [confirmText, setConfirmText] = useState("");
  const canDelete = useMemo(() => confirmText.trim().toUpperCase() === "DELETE", [confirmText]);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);

    const { data } = await supabase.auth.getSession();
    const session = data.session;

    if (!session) {
      router.push("/login");
      return;
    }

    setUserId(session.user.id);
    setEmail(session.user.email ?? "");

    const profRes = await supabase
      .from("profiles")
      .select("id, full_name, role")
      .eq("id", session.user.id)
      .maybeSingle();

    if (profRes.error) {
      setMsg(profRes.error.message);
      setProfile(null);
      setLoading(false);
      return;
    }

    setProfile((profRes.data ?? null) as ProfileRow | null);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  async function logout() {
    setMsg(null);
    await supabase.auth.signOut();
    router.push("/login");
  }

  async function deleteAccount() {
    setMsg(null);

    if (!userId) {
      setMsg("Not logged in.");
      return;
    }
    if (!canDelete) {
      setMsg('Type "DELETE" to confirm.');
      return;
    }

    const ok = window.confirm(
      "This will permanently delete your account and remove your login. This cannot be undone. Continue?"
    );
    if (!ok) return;

    try {
      // Calls your server endpoint (next step)
     const { data } = await supabase.auth.getSession();
const token = data.session?.access_token;

const res = await fetch("/api/delete-account", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({ confirm: "DELETE" }),
});

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(json?.error || "Failed to delete account.");
      }

      // Session is now invalid, but we’ll still sign out locally
      await supabase.auth.signOut();
      router.push("/login");
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to delete account.");
    }
  }

  if (loading) return <div className="p-6 text-black">Loading…</div>;

  const roleLabel = normRole(profile?.role) || "user";

  return (
    <div className="min-h-[100dvh] bg-gray-50 p-4 text-black">
      <div className="mx-auto w-full max-w-md">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="text-xs text-black/60">Account</div>
            <h1 className="text-2xl font-semibold">Profile</h1>
            <div className="mt-1 text-xs text-black/60">Manage your session and account</div>
          </div>

          <div className="flex gap-2">
            <button onClick={() => router.push("/hub")} className="rounded-xl border bg-white px-3 py-2 text-xs">
              Back
            </button>
            <button onClick={load} className="rounded-xl border bg-white px-3 py-2 text-xs">
              Refresh
            </button>
          </div>
        </div>

        {/* Profile card */}
        <div className="rounded-2xl border bg-white p-4 mb-4">
          <div className="text-xs font-semibold text-black/60">Signed in as</div>
          <div className="mt-2 text-sm">
            <div className="font-semibold">{profile?.full_name || "Unnamed user"}</div>
            <div className="text-black/60">{email || "—"}</div>
            <div className="mt-2 inline-flex rounded-full border px-2.5 py-1 text-xs bg-gray-50">
              Role: <span className="ml-1 font-semibold">{roleLabel}</span>
            </div>
          </div>
        </div>

        {/* Logout */}
        <div className="rounded-2xl border bg-white p-4 mb-4">
          <div className="text-sm font-semibold">Session</div>
          <div className="mt-1 text-xs text-black/60">Log out to sign in as a different team member.</div>

          <button
            onClick={logout}
            className="mt-3 w-full rounded-xl bg-black px-4 py-2 text-sm text-white"
          >
            Logout
          </button>
        </div>

        {/* Delete account */}
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
          <div className="text-sm font-semibold text-red-900">Danger zone</div>
          <div className="mt-1 text-xs text-red-900/80">
            Deleting your account will permanently remove your login and profile.
          </div>

          <div className="mt-3">
            <div className="text-xs font-semibold text-red-900/80">Type DELETE to confirm</div>
            <input
              className="mt-2 w-full rounded-xl border px-3 py-2 text-sm bg-white"
              placeholder='Type "DELETE"'
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
            />
          </div>

          <button
            onClick={deleteAccount}
            disabled={!canDelete}
            className="mt-3 w-full rounded-xl border border-red-300 bg-white px-4 py-2 text-sm text-red-700 disabled:opacity-50"
          >
            Delete my account
          </button>
        </div>

        {msg && <div className="mt-4 rounded-xl border bg-gray-50 p-3 text-sm text-black">{msg}</div>}
      </div>
    </div>
  );
}