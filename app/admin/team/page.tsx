"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Profile = {
  id: string;
  full_name: string | null;
  role: string | null;
};

export default function AdminTeamPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setMsg(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session) {
      router.push("/login");
      return;
    }

    // 🔒 Check admin
    const { data: me } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single();

    if (me?.role !== "admin") {
      router.push("/hub");
      return;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, role")
      .order("full_name");

    if (error) {
      setMsg(error.message);
      setProfiles([]);
    } else {
      setProfiles(data ?? []);
    }

    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function updateRole(userId: string, role: string) {
    const ok = window.confirm(`Change role to ${role}?`);
    if (!ok) return;

    const { error } = await supabase
      .from("profiles")
      .update({ role })
      .eq("id", userId);

    if (error) {
      alert(error.message);
    } else {
      await load();
    }
  }

  if (loading) return <div className="p-6">Loading…</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-6 text-black">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Team Management</h1>
          <button
            onClick={() => router.push("/admin")}
            className="rounded-xl border bg-white px-4 py-2 text-sm"
          >
            Back
          </button>
        </div>

        <div className="rounded-2xl border bg-white p-5">
          <div className="text-sm text-black/70 mb-4">
            Users are created via <b>Supabase Auth → Invite user</b>.  
            This page controls <b>roles only</b>.
          </div>

          <div className="space-y-3">
            {profiles.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-xl border p-4"
              >
                <div>
                  <div className="font-medium">
                    {p.full_name ?? "Unnamed user"}
                  </div>
                  <div className="text-xs text-black/60">
                    {p.id.slice(0, 8)}…
                  </div>
                </div>

                <div className="flex gap-2">
                  {["setter", "closer", "admin"].map((r) => (
                    <button
                      key={r}
                      onClick={() => updateRole(p.id, r)}
                      className={`rounded-full px-3 py-1 text-xs border ${
                        p.role === r
                          ? "bg-black text-white"
                          : "bg-white"
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {msg && (
            <div className="mt-4 rounded-xl border bg-gray-50 p-3 text-sm">
              {msg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}