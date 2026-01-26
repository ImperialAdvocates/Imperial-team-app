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
  booked_calendar_user_id: string | null;

  lead_score: number; // 1–2
  showed_up: boolean;
  moved_to_ss2: boolean;
  is_closed: boolean;

  discarded_at?: string | null;
};

type FollowupRow = {
  id: string;
  meeting_id: string;
  owner_user_id: string | null;
  last_followed_up_at: string | null;
  next_followup_at: string | null;
  meeting: MeetingRow | null;
};

function fmtDateTimeAU(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Brisbane",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

const MS_DAY = 1000 * 60 * 60 * 24;

function startOfTodayLocal() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function daysUntilDue(iso: string) {
  const today0 = startOfTodayLocal();
  const due = new Date(iso).getTime();
  return Math.floor((due - today0) / MS_DAY);
}

function dueText(days: number) {
  if (days < 0) return `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}`;
  if (days === 0) return "Due today";
  return `Due in ${days} day${days === 1 ? "" : "s"}`;
}

function sortByPriority(a: FollowupRow, b: FollowupRow) {
  const aIso = a.next_followup_at ?? "";
  const bIso = b.next_followup_at ?? "";
  if (!aIso && !bIso) return 0;
  if (!aIso) return 1;
  if (!bIso) return -1;

  const da = daysUntilDue(aIso);
  const db = daysUntilDue(bIso);

  const group = (d: number) => (d < 0 ? 0 : d === 0 ? 1 : 2);
  const ga = group(da);
  const gb = group(db);
  if (ga !== gb) return ga - gb;

  if (ga === 0) return da - db;
  return new Date(aIso).getTime() - new Date(bIso).getTime();
}

export default function Leads12Page() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [userId, setUserId] = useState<string>("");
  const [rows, setRows] = useState<FollowupRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);

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

    const { data: profs, error: pErr } = await supabase
      .from("profiles")
      .select("id, full_name")
      .order("full_name", { ascending: true });

    if (pErr) {
      setMsg(pErr.message);
      setProfiles([]);
    } else {
      setProfiles((profs ?? []) as ProfileRow[]);
    }

    // ✅ pull followups owned by me, then filter meeting lead_score
    const { data, error } = await supabase
      .from("meeting_followups")
      .select(
        `
          id,
          meeting_id,
          owner_user_id,
          next_followup_at,
          last_followed_up_at,
          meeting:meetings (
            id,
            meeting_name,
            meeting_at,
            booked_by_id,
            attended_by_id,
            booked_calendar_user_id,
            lead_score,
            showed_up,
            moved_to_ss2,
            is_closed,
            discarded_at
          )
        `
      )
      .eq("owner_user_id", uid)
      .not("next_followup_at", "is", null);

    if (error) {
      setMsg(error.message);
      setRows([]);
      setLoading(false);
      return;
    }

    const all = (data ?? []) as unknown as FollowupRow[];

    const mine12 = all
      .filter((r) => {
        const m = r.meeting;
        if (!m) return false;
        if (m.is_closed) return false;
        if (m.discarded_at) return false;
        return m.lead_score === 1 || m.lead_score === 2;
      })
      .sort(sortByPriority);

    setRows(mine12);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  async function markFollowedUp(meetingId: string) {
    setSavingId(meetingId);
    setMsg(null);

    const { error } = await supabase.rpc("mark_meeting_followed_up", {
      p_meeting_id: meetingId,
    });

    if (error) {
      setMsg(error.message);
      setSavingId(null);
      return;
    }

    await load();
    setSavingId(null);
  }

  async function discard(meetingId: string) {
    const ok = window.confirm("Discard this lead? It will be hidden from all pages but still count in KPIs.");
    if (!ok) return;

    setSavingId(meetingId);
    setMsg(null);

    const { error } = await supabase
      .from("meetings")
      .update({ discarded_at: new Date().toISOString() })
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
    <div className="min-h-screen bg-gray-50 p-6 text-black">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold">Leads (Score 1–2)</h1>
            <div className="mt-1 text-xs text-black/70">Only your leads • Score = 1–2 • Not closed • Not discarded</div>
          </div>

          <div className="flex gap-2">
            <button onClick={load} className="rounded-xl border px-4 py-2 text-sm bg-white text-black">
              Refresh
            </button>
            <button onClick={() => router.push("/hub")} className="rounded-xl border px-4 py-2 text-sm bg-white text-black">
              Back
            </button>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-2xl border bg-white p-6 text-sm text-black/70">No leads in your 1–2 pipeline ✅</div>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => {
              const m = r.meeting;
              if (!m || !r.next_followup_at) return null;

              const d = daysUntilDue(r.next_followup_at);
              const badge =
                d < 0
                  ? "bg-red-50 text-red-700 border-red-200"
                  : d === 0
                  ? "bg-amber-50 text-amber-800 border-amber-200"
                  : "bg-white text-black border";

              const ownerName = profilesById[userId]?.full_name ?? "You";
              const calendarOwnerId = m.booked_calendar_user_id ?? m.booked_by_id;
              const calendarOwnerName = profilesById[calendarOwnerId]?.full_name ?? "Calendar owner";

              return (
                <div key={r.id} className={`rounded-2xl border bg-white p-5 ${d < 0 ? "border-red-300" : ""}`}>
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-black truncate">
                        {m.meeting_name || "Unnamed lead"}{" "}
                        <span className="text-xs font-normal text-black/60">(score {m.lead_score})</span>
                      </div>

                      <div className="text-xs text-black/70 mt-1">Meeting: {fmtDateTimeAU(m.meeting_at)}</div>

                      <div className="text-xs text-black/70 mt-1">
                        Owner: <span className="font-medium text-black">{ownerName}</span> • booked calendar:{" "}
                        <span className="font-medium text-black">{calendarOwnerName}</span>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs ${badge}`}>
                          {dueText(d)}
                        </span>
                        <span className="text-xs text-black/70">
                          Follow-up: <span className="font-medium text-black">{fmtDateTimeAU(r.next_followup_at)}</span>
                        </span>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                        <div className="rounded-xl border px-3 py-2 flex justify-between">
                          <span>Showed up</span>
                          <span className="font-medium">{m.showed_up ? "Yes" : "No"}</span>
                        </div>
                        <div className="rounded-xl border px-3 py-2 flex justify-between">
                          <span>Moved to SS2</span>
                          <span className="font-medium">{m.moved_to_ss2 ? "Yes" : "No"}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <button
                        onClick={() => markFollowedUp(m.id)}
                        disabled={savingId === m.id}
                        className="rounded-xl bg-black px-4 py-2 text-sm text-white disabled:opacity-60"
                      >
                        {savingId === m.id ? "Saving…" : "Followed up ✅"}
                      </button>

                      <button
                        onClick={() => discard(m.id)}
                        disabled={savingId === m.id}
                        className="rounded-xl border px-4 py-2 text-sm bg-white text-black disabled:opacity-60"
                      >
                        {savingId === m.id ? "Working…" : "Discard"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {msg && <div className="mt-6 rounded-xl border bg-gray-50 p-3 text-sm text-black">{msg}</div>}
      </div>
    </div>
  );
}