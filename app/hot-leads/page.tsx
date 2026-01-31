"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ProfileRow = {
  id: string;
  full_name: string | null;
};

type MeetingRow = {
  id: string;
  meeting_name: string | null;
  meeting_at: string;

  booked_by_id: string;
  attended_by_id: string;

  lead_score: number;

  showed_up: boolean;
  moved_to_ss2: boolean;

  discarded_at: string | null;
  created_at: string;
};

function fmtDateTimeAU(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function initials(name?: string | null) {
  const n = (name ?? "").trim();
  if (!n) return "—";
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function normRole(r?: string | null) {
  return (r ?? "").trim().toLowerCase();
}

export default function HotLeadsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [isAdmin, setIsAdmin] = useState(false);

  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const profilesById = useMemo(() => {
    const map: Record<string, ProfileRow> = {};
    profiles.forEach((p) => (map[p.id] = p));
    return map;
  }, [profiles]);

  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session) {
      router.push("/login");
      return;
    }

    const uid = session.user.id;

    try {
      // Check admin (admins see all hot leads; non-admin see only those booked/taken by them)
      const meRes = await supabase.from("profiles").select("id, role, is_admin").eq("id", uid).single();
      if (meRes.error) throw new Error(meRes.error.message);

      const adminFlag = !!meRes.data?.is_admin || normRole(meRes.data?.role) === "admin";
      setIsAdmin(adminFlag);

      // profiles for names
      const profRes = await supabase
        .from("profiles")
        .select("id, full_name")
        .order("full_name", { ascending: true });

      if (profRes.error) throw new Error(profRes.error.message);
      setProfiles((profRes.data ?? []) as ProfileRow[]);

      // Hot leads = lead_score = 3 and not discarded
      let hotQ = supabase
        .from("meetings")
        .select(
          "id, meeting_name, meeting_at, booked_by_id, attended_by_id, lead_score, showed_up, moved_to_ss2, discarded_at, created_at"
        )
        .eq("lead_score", 3)
        .is("discarded_at", null)
        .order("meeting_at", { ascending: false })
        .limit(1000);

      // Non-admin only sees their own hot leads
      if (!adminFlag) {
        hotQ = hotQ.or(`booked_by_id.eq.${uid},attended_by_id.eq.${uid}`);
      }

      const hotRes = await hotQ;
      if (hotRes.error) throw new Error(hotRes.error.message);

      setMeetings((hotRes.data ?? []) as MeetingRow[]);
      setLoading(false);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to load hot leads.");
      setMeetings([]);
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return meetings;
    return meetings.filter((m) => (m.meeting_name ?? "").toLowerCase().includes(qq));
  }, [meetings, q]);

  async function setLeadScore(meetingId: string, nextScore: number) {
    setSavingId(meetingId);
    setMsg(null);

    try {
      const { error } = await supabase
        .from("meetings")
        .update({ lead_score: nextScore })
        .eq("id", meetingId);

      if (error) throw new Error(error.message);

      // remove locally if not hot anymore
      if (nextScore !== 3) {
        setMeetings((prev) => prev.filter((m) => m.id !== meetingId));
      } else {
        await load();
      }
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to update lead score.");
    } finally {
      setSavingId(null);
    }
  }

  async function discardMeeting(meetingId: string) {
    const ok = window.confirm("Discard this hot lead? It will be hidden from the list.");
    if (!ok) return;

    setSavingId(meetingId);
    setMsg(null);

    try {
      const { error } = await supabase
        .from("meetings")
        .update({ discarded_at: new Date().toISOString() })
        .eq("id", meetingId);

      if (error) throw new Error(error.message);

      setMeetings((prev) => prev.filter((m) => m.id !== meetingId));
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to discard hot lead.");
    } finally {
      setSavingId(null);
    }
  }

  if (loading) return <div className="p-6 text-black">Loading…</div>;

  return (
    <div className="min-h-[100dvh] bg-gray-50 p-4 text-black">
      <div className="mx-auto w-full max-w-3xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h1 className="text-2xl font-semibold">Hot Leads</h1>
            <div className="mt-1 text-xs text-black/60">
              Hot lead = <b>lead_score = 3</b> • {isAdmin ? "All hot leads" : "Only your hot leads"}
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={load} className="rounded-xl border bg-white px-3 py-2 text-xs">
              Refresh
            </button>
            <button onClick={() => router.push("/hub")} className="rounded-xl border bg-white px-3 py-2 text-xs">
              Back
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="rounded-2xl border bg-white p-4 mb-4">
          <div className="text-xs font-semibold text-black/60">Search</div>
          <input
            className="mt-2 w-full rounded-xl border px-3 py-2 text-sm"
            placeholder="Search by meeting name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="mt-2 text-[11px] text-black/50">
            Showing <b>{filtered.length}</b> of <b>{meetings.length}</b>
          </div>
        </div>

        {/* List */}
        {filtered.length === 0 ? (
          <div className="rounded-2xl border bg-white p-6 text-sm text-black/70">No hot leads ✅</div>
        ) : (
          <div className="space-y-3">
            {filtered.map((m) => {
              const bookedName = profilesById[m.booked_by_id]?.full_name ?? "—";
              const takenName = profilesById[m.attended_by_id]?.full_name ?? "—";

              return (
                <div key={m.id} className="rounded-2xl border bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    {/* Left */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-xl border bg-gray-50 flex items-center justify-center text-xs font-semibold">
                          {initials(m.meeting_name)}
                        </div>

                        <div className="min-w-0">
                          <div className="text-sm font-semibold truncate">{m.meeting_name || "Unnamed meeting"}</div>
                          <div className="mt-1 text-xs text-black/60">{fmtDateTimeAU(m.meeting_at)}</div>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs bg-red-50 border-red-200 text-red-700">
                          Hot (3)
                        </span>

                        {m.showed_up ? (
                          <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs bg-green-50 border-green-200 text-green-700">
                            Showed
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs bg-gray-50 border-gray-200 text-black/70">
                            Not showed
                          </span>
                        )}

                        {m.moved_to_ss2 ? (
                          <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs bg-blue-50 border-blue-200 text-blue-700">
                            Moved to SS2
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-black/70">
                        <div className="rounded-xl border bg-white px-3 py-2">
                          Booked by: <span className="font-medium text-black">{bookedName}</span>
                        </div>
                        <div className="rounded-xl border bg-white px-3 py-2">
                          Taken by: <span className="font-medium text-black">{takenName}</span>
                        </div>
                      </div>
                    </div>

                    {/* Right */}
                    <div className="flex flex-col items-end gap-2">
                      <span className="text-[11px] text-black/40 font-mono">{m.id.slice(0, 8)}…</span>

                      <button
                        onClick={() => router.push("/meetings")}
                        className="rounded-xl bg-black px-3 py-2 text-xs text-white"
                      >
                        Open meetings
                      </button>

                      <div className="flex gap-2">
                        <button
                          onClick={() => setLeadScore(m.id, 2)}
                          disabled={savingId === m.id}
                          className="rounded-xl border bg-white px-3 py-2 text-xs disabled:opacity-60"
                          title="Set lead_score to 2 (removes from hot leads)"
                        >
                          {savingId === m.id ? "Saving…" : "Set 2"}
                        </button>

                        <button
                          onClick={() => setLeadScore(m.id, 1)}
                          disabled={savingId === m.id}
                          className="rounded-xl border bg-white px-3 py-2 text-xs disabled:opacity-60"
                          title="Set lead_score to 1 (removes from hot leads)"
                        >
                          {savingId === m.id ? "Saving…" : "Set 1"}
                        </button>
                      </div>

                      <button
                        onClick={() => discardMeeting(m.id)}
                        disabled={savingId === m.id}
                        className="w-full rounded-xl border bg-white px-3 py-2 text-xs disabled:opacity-60"
                      >
                        {savingId === m.id ? "Saving…" : "Discard"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {msg && <div className="mt-4 rounded-xl border bg-gray-50 p-3 text-sm text-black">{msg}</div>}
      </div>
    </div>
  );
}