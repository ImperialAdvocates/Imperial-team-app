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

  booked_by_id: string | null;
  attended_by_id: string | null;
  booked_calendar_user_id: string | null;

  lead_score: number | null;

  is_closed: boolean | null;
  closed_at: string | null;

  discarded_at: string | null;

  owner_id: string | null;
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

function ownerIdForMeeting(m: MeetingRow) {
  return m.owner_id ?? m.attended_by_id ?? m.booked_by_id ?? m.booked_calendar_user_id ?? null;
}

function initials(name?: string | null) {
  const n = (name ?? "").trim();
  if (!n) return "—";
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function HotLeadsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [userId, setUserId] = useState<string>("");
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);

  const [q, setQ] = useState("");

  const profilesById = useMemo(() => {
    const map: Record<string, ProfileRow> = {};
    profiles.forEach((p) => (map[p.id] = p));
    return map;
  }, [profiles]);

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
    setUserId(uid);

    try {
      const profRes = await supabase
        .from("profiles")
        .select("id, full_name")
        .order("full_name", { ascending: true });

      if (profRes.error) throw new Error(profRes.error.message);
      setProfiles((profRes.data ?? []) as ProfileRow[]);

      const hotRes = await supabase
        .from("meetings")
        .select(
          `
          id,
          meeting_name,
          meeting_at,
          booked_by_id,
          attended_by_id,
          booked_calendar_user_id,
          lead_score,
          is_closed,
          closed_at,
          discarded_at,
          owner_id
        `
        )
        .eq("lead_score", 3)
        .eq("is_closed", false)
        .is("discarded_at", null)
        .order("meeting_at", { ascending: false });

      if (hotRes.error) throw new Error(hotRes.error.message);

      const all = (hotRes.data ?? []) as MeetingRow[];

      // Mine only (owner_id -> attended_by -> booked_by -> booked_calendar)
      const mine = all.filter((m) => ownerIdForMeeting(m) === uid);

      setMeetings(mine);
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

  async function markClosed(meetingId: string) {
    setSavingId(meetingId);
    setMsg(null);

    const { error } = await supabase
      .from("meetings")
      .update({
        is_closed: true,
        closed_at: new Date().toISOString(),
      })
      .eq("id", meetingId);

    if (error) {
      setMsg(error.message);
      setSavingId(null);
      return;
    }

    await load();
    setSavingId(null);
  }

  async function discardMeeting(meetingId: string) {
    setSavingId(meetingId);
    setMsg(null);

    const { error } = await supabase
      .from("meetings")
      .update({
        discarded_at: new Date().toISOString(),
      })
      .eq("id", meetingId);

    if (error) {
      setMsg(error.message);
      setSavingId(null);
      return;
    }

    await load();
    setSavingId(null);
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
              Score = 3 • assigned to you • admin controls ownership
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
          <div className="rounded-2xl border bg-white p-6 text-sm text-black/70">
            No hot leads assigned to you ✅
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((m) => {
              const ownerId = ownerIdForMeeting(m);
              const ownerName = ownerId ? profilesById[ownerId]?.full_name ?? "Unknown" : "Unassigned";
              const bookedName = m.booked_by_id ? profilesById[m.booked_by_id]?.full_name ?? "Unknown" : "—";
              const attendedName = m.attended_by_id ? profilesById[m.attended_by_id]?.full_name ?? "Unknown" : "—";

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
                          <div className="text-sm font-semibold truncate">
                            {m.meeting_name || "Unnamed meeting"}
                          </div>
                          <div className="mt-1 text-xs text-black/60">
                            {fmtDateTimeAU(m.meeting_at)}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs bg-red-50 border-red-200 text-red-700">
                          Hot lead
                        </span>
                        <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs bg-white">
                          Owner: <span className="ml-1 font-medium">{ownerName}</span>
                        </span>
                      </div>

                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-black/70">
                        <div className="rounded-xl border bg-white px-3 py-2">
                          Booked by: <span className="font-medium text-black">{bookedName}</span>
                        </div>
                        <div className="rounded-xl border bg-white px-3 py-2">
                          Attended by: <span className="font-medium text-black">{attendedName}</span>
                        </div>
                      </div>
                    </div>

                    {/* Right */}
                    <div className="flex flex-col items-end gap-2">
                      <span className="text-[11px] text-black/40 font-mono">
                        {m.id.slice(0, 8)}…
                      </span>

                      <button
                        onClick={() => router.push("/meetings")}
                        className="rounded-xl bg-black px-3 py-2 text-xs text-white"
                        title="Go to Meetings to update outcomes"
                      >
                        Open meetings
                      </button>

                      <button
                        onClick={() => markClosed(m.id)}
                        disabled={savingId === m.id}
                        className="w-full rounded-xl border bg-white px-3 py-2 text-xs text-black disabled:opacity-60"
                        title="Marks this meeting as closed (removes from hot leads)"
                      >
                        {savingId === m.id ? "Saving…" : "Mark closed"}
                      </button>

                      <button
                        onClick={() => discardMeeting(m.id)}
                        disabled={savingId === m.id}
                        className="w-full rounded-xl border bg-white px-3 py-2 text-xs text-black disabled:opacity-60"
                        title="Discards this meeting (removes from hot leads)"
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