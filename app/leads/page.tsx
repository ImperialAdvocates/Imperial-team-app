"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ProfileRow = {
  id: string;
  full_name: string | null;
  role?: string | null;
  is_admin?: boolean | null;
};

type MeetingRow = {
  id: string;
  meeting_name: string | null;
  meeting_at: string;

  // ✅ NEW
  discarded_at: string | null;

  booked_by_id: string;
  attended_by_id: string;
  booked_calendar_user_id: string | null;

  lead_score: number; // 1–3
  showed_up: boolean;
  moved_to_ss2: boolean;
  is_closed: boolean;
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

function isOverdue(nextIso: string | null) {
  if (!nextIso) return false;
  return new Date(nextIso).getTime() <= Date.now();
}

/**
 * Priority:
 * - More overdue first (more negative days first)
 * - Then earlier due timestamp
 */
function sortByPriority(a: FollowupRow, b: FollowupRow) {
  const aIso = a.next_followup_at ?? "";
  const bIso = b.next_followup_at ?? "";
  if (!aIso && !bIso) return 0;
  if (!aIso) return 1;
  if (!bIso) return -1;

  const da = daysUntilDue(aIso);
  const db = daysUntilDue(bIso);

  if (da !== db) return da - db;
  return new Date(aIso).getTime() - new Date(bIso).getTime();
}

function ownerIdForRow(r: FollowupRow) {
  const m = r.meeting!;
  return r.owner_user_id ?? m.attended_by_id ?? m.booked_by_id;
}

export default function LeadsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [userId, setUserId] = useState<string>("");
  const [isAdmin, setIsAdmin] = useState(false);

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

    // who am I
    const { data: meRows, error: meErr } = await supabase
      .from("profiles")
      .select("id, role, is_admin")
      .eq("id", uid)
      .limit(1);

    if (meErr) {
      setMsg(meErr.message);
      setLoading(false);
      return;
    }

    const me = (meRows ?? [])[0] as any;
    const adminFlag = String(me?.role ?? "").toLowerCase() === "admin" || !!me?.is_admin;
    setIsAdmin(adminFlag);

    // profiles (for display + admin assign)
    const { data: profs, error: pErr } = await supabase
      .from("profiles")
      .select("id, full_name, role, is_admin")
      .order("full_name", { ascending: true });

    if (pErr) {
      setMsg(pErr.message);
      setProfiles([]);
    } else {
      setProfiles((profs ?? []) as ProfileRow[]);
    }

    // Load followups + meeting data
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
            discarded_at,
            booked_by_id,
            attended_by_id,
            booked_calendar_user_id,
            lead_score,
            showed_up,
            moved_to_ss2,
            is_closed
          )
        `
      )
      .not("next_followup_at", "is", null); // only those with a due date

    if (error) {
      setMsg(error.message);
      setRows([]);
      setLoading(false);
      return;
    }

    const all = (data ?? []) as unknown as FollowupRow[];

    // ✅ ONLY OVERDUE leads (score 1–3, not closed, not discarded)
    const overdueOnly = all
      .filter((r) => {
        const m = r.meeting;
        if (!m) return false;
        if (m.is_closed) return false;
        if (m.discarded_at) return false; // ✅ hide discarded everywhere
        if (m.lead_score < 1 || m.lead_score > 3) return false;
        return isOverdue(r.next_followup_at);
      })
      .sort(sortByPriority);

    setRows(overdueOnly);
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

  async function claim(meetingId: string) {
    setSavingId(meetingId);
    setMsg(null);

    const { error } = await supabase.rpc("claim_lead_and_push_followup", {
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

  async function adminAssign(meetingId: string, ownerId: string) {
    setSavingId(meetingId);
    setMsg(null);

    const { error } = await supabase.rpc("admin_set_followup_owner", {
      p_meeting_id: meetingId,
      p_owner: ownerId,
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
    const ok = window.confirm(
      "Discard this lead?\n\nIt will be hidden from Leads/Hot Leads pages, but it will still count in KPIs."
    );
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

  const stats = useMemo(() => {
    let overdue = 0;
    rows.forEach((r) => {
      if (!r.next_followup_at) return;
      const d = daysUntilDue(r.next_followup_at);
      if (d < 0) overdue++;
    });
    return { overdue, total: rows.length };
  }, [rows]);

  if (loading) return <div className="p-6 text-black">Loading…</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-6 text-black">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold">Leads (Overdue)</h1>
            <div className="mt-1 text-xs text-black/70">
              Only overdue follow-ups show here • Score 1–3 • Claiming happens here • Follow-up/Claim sets next follow-up to +3 days • Discard hides lead from pages
            </div>
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

        <div className="mb-4 rounded-2xl border bg-white p-4 text-sm text-black">
          <div className="font-medium">Summary</div>
          <div className="mt-1 text-xs text-black/70">
            🔴 Overdue: {stats.overdue} • Total showing: {stats.total}
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-2xl border bg-white p-6 text-sm text-black/70">
            No overdue leads ✅
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => {
              const m = r.meeting;
              if (!m || !r.next_followup_at) return null;

              const d = daysUntilDue(r.next_followup_at);
              const badge = "bg-red-50 text-red-700 border-red-200";

              const ownerId = ownerIdForRow(r);
              const ownerName = profilesById[ownerId]?.full_name ?? "Unassigned";
              const isOwner = ownerId === userId;

              const calendarOwnerId = m.booked_calendar_user_id ?? m.booked_by_id;
              const calendarOwnerName = profilesById[calendarOwnerId]?.full_name ?? "Calendar owner";

              return (
                <div key={r.id} className="rounded-2xl border border-red-300 bg-white p-5">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">
                        {m.meeting_name || "Unnamed lead"}{" "}
                        <span className="text-xs font-normal text-black/60">(score {m.lead_score})</span>
                      </div>

                      <div className="text-xs text-black/70 mt-1">Meeting: {fmtDateTimeAU(m.meeting_at)}</div>

                      <div className="text-xs text-black/70 mt-1">
                        Owner: <span className="font-medium text-black">{ownerName}</span>
                        {!isOwner ? <span className="ml-2 text-red-700">• claimable</span> : null}
                        {" • "}
                        booked calendar: <span className="font-medium text-black">{calendarOwnerName}</span>
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

                      {isAdmin && (
                        <div className="mt-3">
                          <div className="text-xs text-black/60 mb-1">Admin: assign owner</div>
                          <select
                            className="w-full rounded-xl border px-3 py-2 bg-white text-sm"
                            value={ownerId}
                            disabled={savingId === m.id}
                            onChange={(e) => adminAssign(m.id, e.target.value)}
                          >
                            {profiles.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.full_name ?? p.id}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-2 min-w-[180px]">
                      {isOwner ? (
                        <button
                          onClick={() => markFollowedUp(m.id)}
                          disabled={savingId === m.id}
                          className="rounded-xl bg-black px-4 py-2 text-sm text-white disabled:opacity-60"
                          title="Marks followed up and schedules next follow-up (+3 days)"
                        >
                          {savingId === m.id ? "Saving…" : "Followed up ✅"}
                        </button>
                      ) : (
                        <button
                          onClick={() => claim(m.id)}
                          disabled={savingId === m.id}
                          className="rounded-xl bg-black px-4 py-2 text-sm text-white disabled:opacity-60"
                          title="Claims this lead and sets next follow-up +3 days"
                        >
                          {savingId === m.id ? "Claiming…" : "Claim lead"}
                        </button>
                      )}

                      {/* ✅ Discard (owner or admin only) */}
                      {(isOwner || isAdmin) && (
                        <button
                          onClick={() => discard(m.id)}
                          disabled={savingId === m.id}
                          className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm text-black disabled:opacity-60"
                          title="Hides this lead from all lead pages, but keeps it in KPI history"
                        >
                          {savingId === m.id ? "Working…" : "Discard"}
                        </button>
                      )}
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