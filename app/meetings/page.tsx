"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

/* ---------------- Types ---------------- */

type ProfileRow = {
  id: string;
  full_name: string | null;
  role?: string | null;
  is_admin?: boolean | null;
};

type MeetingRow = {
  id: string;
  meeting_name: string | null;
  meeting_at: string; // timestamptz

  booked_by_id: string;
  attended_by_id: string;

  lead_score: number;

  showed_up: boolean;
  moved_to_ss2: boolean;

  discarded_at: string | null;
  created_at: string;
};

type PersonMode = "either" | "booked_by" | "taken_by";
type RangePreset = "week" | "month" | "all";

/* ---------------- Utils ---------------- */

function normRole(r?: string | null) {
  return (r ?? "").trim().toLowerCase();
}

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

/** For <input type="datetime-local"> we need "YYYY-MM-DDTHH:mm" */
function toDatetimeLocalValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function fromDatetimeLocalToIso(value: string) {
  const d = new Date(value);
  return d.toISOString();
}

function initials(name?: string | null) {
  const n = (name ?? "").trim();
  if (!n) return "—";
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function toISODateMelb(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Monday-start week in Melbourne time, returned as YYYY-MM-DD */
function startOfWeekISO_Melb(today: Date) {
  const local = new Date(today);
  const day = local.getDay(); // 0 Sun .. 6 Sat
  const diffToMon = (day + 6) % 7;
  local.setDate(local.getDate() - diffToMon);
  local.setHours(0, 0, 0, 0);
  return toISODateMelb(local);
}

function addDaysISO(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toISODateMelb(d);
}

function fmtRangeShort(startISO: string, endExclusiveISO: string) {
  const endLabel = addDaysISO(endExclusiveISO, -1);
  return `${startISO} → ${endLabel}`;
}

/**
 * Business month:
 * - starts on the 26th
 * - ends (exclusive) on the 26th of next month
 */
function businessMonthRangeISO(now: Date) {
  const nowISO = toISODateMelb(now); // Melbourne date
  const y = Number(nowISO.slice(0, 4));
  const m = Number(nowISO.slice(5, 7)) - 1;
  const d = Number(nowISO.slice(8, 10));

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (d >= 26) start.setFullYear(y, m, 26);
  else start.setFullYear(y, m - 1, 26);

  const endExclusive = new Date(start);
  endExclusive.setMonth(endExclusive.getMonth() + 1);
  endExclusive.setDate(26);
  endExclusive.setHours(0, 0, 0, 0);

  return {
    monthStartISO: toISODateMelb(start),
    monthEndExclusiveISO: toISODateMelb(endExclusive),
  };
}

/**
 * Convert Melbourne “YYYY-MM-DD” midnight into a UTC ISO string using the
 * correct Melbourne offset for that date (handles DST).
 */
function melbMidnightToUtcIso(dateISO: string) {
  const baseUtc = new Date(`${dateISO}T00:00:00Z`);

  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    timeZoneName: "shortOffset",
    year: "numeric",
  }).formatToParts(baseUtc);

  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+11";
  const m = tz.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);

  let offsetMin = 11 * 60;
  if (m) {
    const sign = m[1] === "-" ? -1 : 1;
    const hh = Number(m[2] ?? "0");
    const mm = Number(m[3] ?? "0");
    offsetMin = sign * (hh * 60 + mm);
  }

  const melbMidnightUtcMs = Date.parse(`${dateISO}T00:00:00Z`) - offsetMin * 60_000;
  return new Date(melbMidnightUtcMs).toISOString();
}

function rangeLabel(
  preset: RangePreset,
  weekStartISO: string,
  weekEndExclusiveISO: string,
  monthStartISO: string,
  monthEndExclusiveISO: string
) {
  if (preset === "week") return `This week: ${fmtRangeShort(weekStartISO, weekEndExclusiveISO)}`;
  if (preset === "month") return `This month: ${fmtRangeShort(monthStartISO, monthEndExclusiveISO)}`;
  return "All time";
}

/* ---------------- Component ---------------- */

export default function MeetingsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [userId, setUserId] = useState<string>("");
  const [myRole, setMyRole] = useState<string>("");
  const [isAdmin, setIsAdmin] = useState(false);

  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const profilesById = useMemo(() => {
    const m: Record<string, ProfileRow> = {};
    profiles.forEach((p) => (m[p.id] = p));
    return m;
  }, [profiles]);

  const [meetings, setMeetings] = useState<MeetingRow[]>([]);

  /* ---------------- Filters ---------------- */

  const [rangePreset, setRangePreset] = useState<RangePreset>("week");

  const [searchInput, setSearchInput] = useState("");
  const [searchApplied, setSearchApplied] = useState("");

  const [personMode, setPersonMode] = useState<PersonMode>("either");
  const [personId, setPersonId] = useState<string>(""); // "" = all

  // Date windows
  const weekStartISO = useMemo(() => startOfWeekISO_Melb(new Date()), []);
  const weekEndExclusiveISO = useMemo(() => addDaysISO(weekStartISO, 7), [weekStartISO]);

  const { monthStartISO, monthEndExclusiveISO } = useMemo(() => businessMonthRangeISO(new Date()), []);

  // Active UTC range for meetings query
  const rangeStartUtcIso = useMemo(() => {
    if (rangePreset === "week") return melbMidnightToUtcIso(weekStartISO);
    if (rangePreset === "month") return melbMidnightToUtcIso(monthStartISO);
    return null;
  }, [rangePreset, weekStartISO, monthStartISO]);

  const rangeEndUtcIso = useMemo(() => {
    if (rangePreset === "week") return melbMidnightToUtcIso(weekEndExclusiveISO);
    if (rangePreset === "month") return melbMidnightToUtcIso(monthEndExclusiveISO);
    return null;
  }, [rangePreset, weekEndExclusiveISO, monthEndExclusiveISO]);

  /* ---------------- Create form ---------------- */

  const [meetingName, setMeetingName] = useState<string>("");
  const [meetingAtLocal, setMeetingAtLocal] = useState(() => toDatetimeLocalValue(new Date()));

  const [bookedById, setBookedById] = useState<string>("");
  const [attendedById, setAttendedById] = useState<string>("");

  const [leadScore, setLeadScore] = useState<number>(1);
  const [showedUp, setShowedUp] = useState<boolean>(true);
  const [movedToSs2, setMovedToSs2] = useState<boolean>(false);

  const [creating, setCreating] = useState(false);
  const [savingMeetingId, setSavingMeetingId] = useState<string | null>(null);

  /* ---------------- Load ---------------- */

  const load = useCallback(
    async (overrideSearch?: string) => {
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
        // me
        const meRes = await supabase.from("profiles").select("id, role, is_admin").eq("id", uid).single();
        if (meRes.error) throw new Error(meRes.error.message);

        const r = normRole(meRes.data?.role);
        setMyRole(r);

        const adminFlag = !!meRes.data?.is_admin || r === "admin";
        setIsAdmin(adminFlag);

        // profiles
        const pRes = await supabase
          .from("profiles")
          .select("id, full_name, role, is_admin")
          .order("full_name", { ascending: true });

        if (pRes.error) throw new Error(pRes.error.message);
        setProfiles((pRes.data ?? []) as ProfileRow[]);

        // meetings query
        let q = supabase
          .from("meetings")
          .select(
            "id, meeting_name, meeting_at, booked_by_id, attended_by_id, lead_score, showed_up, moved_to_ss2, discarded_at, created_at"
          )
          .is("discarded_at", null)
          .order("meeting_at", { ascending: false })
          .limit(1000);

        // Range filter (week/month) — all-time skips this
        if (rangePreset !== "all" && rangeStartUtcIso && rangeEndUtcIso) {
          q = q.gte("meeting_at", rangeStartUtcIso).lt("meeting_at", rangeEndUtcIso);
        }

        // Non-admin: keep it restricted
        if (!adminFlag) {
          q = q.or(`booked_by_id.eq.${uid},attended_by_id.eq.${uid}`);
        }

        // Person filter
        if (personId) {
          if (personMode === "booked_by") q = q.eq("booked_by_id", personId);
          else if (personMode === "taken_by") q = q.eq("attended_by_id", personId);
          else q = q.or(`booked_by_id.eq.${personId},attended_by_id.eq.${personId}`);
        }

        // Search
        const term = (overrideSearch ?? searchApplied).trim();
        if (term) q = q.ilike("meeting_name", `%${term}%`);

        const mtgRes = await q;
        if (mtgRes.error) throw new Error(mtgRes.error.message);

        setMeetings((mtgRes.data ?? []) as MeetingRow[]);
        setLoading(false);
      } catch (e: any) {
        setMsg(e?.message ?? "Failed to load meetings.");
        setLoading(false);
      }
    },
    [router, rangePreset, rangeStartUtcIso, rangeEndUtcIso, personId, personMode, searchApplied]
  );

  // initial load
  useEffect(() => {
    load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // reload when non-search filters change
  useEffect(() => {
    load();
  }, [rangePreset, personId, personMode]); // intentionally excludes searchInput

  // defaults once profiles loaded
  useEffect(() => {
    if (!userId || profiles.length === 0) return;
    if (!bookedById) setBookedById(userId);
    if (!attendedById) setAttendedById(userId);
  }, [userId, profiles, bookedById, attendedById]);

  /* ---------------- Create meeting ---------------- */

  async function createMeeting() {
    setCreating(true);
    setMsg(null);

    try {
      if (!userId) throw new Error("Not logged in.");
      if (!bookedById) throw new Error("Select who booked it.");
      if (!attendedById) throw new Error("Select who took it.");

      const meetingAtIso = fromDatetimeLocalToIso(meetingAtLocal);

      const payload = {
        meeting_name: meetingName.trim() ? meetingName.trim() : null,
        meeting_at: meetingAtIso,
        booked_by_id: bookedById,
        attended_by_id: attendedById,
        lead_score: leadScore,
        showed_up: showedUp,
        moved_to_ss2: movedToSs2,
        discarded_at: null,
      };

      const { error } = await supabase.from("meetings").insert(payload);
      if (error) throw new Error(error.message);

      await load();

      setMeetingName("");
      setLeadScore(1);
      setMovedToSs2(false);
      setShowedUp(true);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to create meeting.");
    } finally {
      setCreating(false);
    }
  }

  /* ---------------- Save meeting edits ---------------- */

  async function saveMeetingUpdates(m: MeetingRow) {
    setSavingMeetingId(m.id);
    setMsg(null);

    try {
      const payload = {
        meeting_name: m.meeting_name,
        meeting_at: m.meeting_at,
        booked_by_id: m.booked_by_id,
        attended_by_id: m.attended_by_id,
        lead_score: m.lead_score,
        showed_up: m.showed_up,
        moved_to_ss2: m.moved_to_ss2,
      };

      const { error } = await supabase.from("meetings").update(payload).eq("id", m.id);
      if (error) throw new Error(error.message);

      await load();
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to save meeting.");
    } finally {
      setSavingMeetingId(null);
    }
  }

  async function discardMeeting(meetingId: string) {
    const ok = window.confirm("Discard this meeting? It will disappear from the list but stay saved for KPIs.");
    if (!ok) return;

    setSavingMeetingId(meetingId);
    setMsg(null);

    try {
      const { error } = await supabase
        .from("meetings")
        .update({ discarded_at: new Date().toISOString() })
        .eq("id", meetingId);

      if (error) throw new Error(error.message);

      setMeetings((prev) => prev.filter((m) => m.id !== meetingId));
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to discard meeting.");
    } finally {
      setSavingMeetingId(null);
    }
  }

  function patchMeeting(id: string, patch: Partial<MeetingRow>) {
    setMeetings((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  if (loading) return <div className="p-6 text-black">Loading…</div>;

  return (
    <div className="min-h-[100dvh] bg-gray-50 p-4 text-black">
      <div className="mx-auto w-full max-w-3xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h1 className="text-2xl font-semibold text-black">Meetings</h1>
            <div className="mt-1 text-xs text-black/60">
              Simple meeting tracker (Booked by / Taken by / Score / Showed / Moved).
            </div>
            <div className="mt-1 text-[11px] text-black/50">
              Logged in as: <span className="font-medium">{myRole || "user"}</span>
              {isAdmin ? " (admin)" : ""}
            </div>
          </div>

          <div className="flex gap-2 flex-wrap justify-end">
            <button onClick={() => router.push("/hub")} className="rounded-xl border bg-white px-3 py-2 text-xs">
              Hub
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-4 rounded-2xl border bg-white p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-xs font-semibold text-black/60">Filters</div>
              <div className="mt-1 text-[11px] text-black/50">
                <b>{rangeLabel(rangePreset, weekStartISO, weekEndExclusiveISO, monthStartISO, monthEndExclusiveISO)}</b>
              </div>
            </div>

            <div className="flex gap-2 flex-wrap">
              <select
                className="rounded-xl border px-3 py-2 text-sm bg-white"
                value={rangePreset}
                onChange={(e) => setRangePreset(e.target.value as RangePreset)}
              >
                <option value="week">This week</option>
                <option value="month">This month</option>
                <option value="all">All time</option>
              </select>

              <select
                className="rounded-xl border px-3 py-2 text-sm bg-white"
                value={personMode}
                onChange={(e) => setPersonMode(e.target.value as PersonMode)}
              >
                <option value="either">Booked or Taken</option>
                <option value="booked_by">Booked by</option>
                <option value="taken_by">Taken by</option>
              </select>

              <select
                className="rounded-xl border px-3 py-2 text-sm bg-white"
                value={personId}
                onChange={(e) => setPersonId(e.target.value)}
              >
                <option value="">All people</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name ?? p.id}
                  </option>
                ))}
              </select>

              <button
                onClick={() => {
                  const next = searchInput;
                  setSearchApplied(next);
                  load(next);
                }}
                className="rounded-xl border bg-white px-3 py-2 text-sm"
              >
                Apply
              </button>
            </div>
          </div>

          <div className="mt-3">
            <div className="text-xs font-semibold text-black/60">Search meetings</div>
            <input
              className="mt-2 w-full rounded-xl border px-3 py-2 text-sm text-black"
              placeholder="Type a name…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const next = searchInput;
                  setSearchApplied(next);
                  load(next);
                }
              }}
            />
          </div>
        </div>

        {/* Create */}
        <div className="rounded-2xl border bg-white p-5 mb-6">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-sm font-semibold text-black">Add meeting</h2>
              <div className="mt-1 text-xs text-black/60">Booker + taker + score + outcomes.</div>
            </div>

            <button
              onClick={createMeeting}
              disabled={creating}
              className="rounded-xl bg-black px-4 py-2 text-sm text-white disabled:opacity-60"
            >
              {creating ? "Creating…" : "Create"}
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-black">Meeting name</label>
              <input
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm text-black"
                placeholder="e.g. Sachin – IS"
                value={meetingName}
                onChange={(e) => setMeetingName(e.target.value)}
              />
            </div>

            <div>
              <label className="text-xs font-medium text-black">Meeting date/time</label>
              <input
                type="datetime-local"
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm text-black"
                value={meetingAtLocal}
                onChange={(e) => setMeetingAtLocal(e.target.value)}
              />
            </div>

            <div>
              <label className="text-xs font-medium text-black">Lead score</label>
              <select
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white text-black"
                value={leadScore}
                onChange={(e) => setLeadScore(Number(e.target.value))}
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3 (Hot)</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-black">Booked by</label>
              <select
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white text-black"
                value={bookedById}
                onChange={(e) => setBookedById(e.target.value)}
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name ?? p.id}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-black">Taken by</label>
              <select
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white text-black"
                value={attendedById}
                onChange={(e) => setAttendedById(e.target.value)}
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name ?? p.id}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <div className="text-xs font-medium text-black mb-2">Outcomes</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm bg-white">
                  <span className="text-black">Showed up</span>
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={showedUp}
                    onChange={(e) => setShowedUp(e.target.checked)}
                  />
                </label>

                <label className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm bg-white">
                  <span className="text-black">Moved to SS2</span>
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={movedToSs2}
                    onChange={(e) => setMovedToSs2(e.target.checked)}
                  />
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* List */}
        <div className="rounded-2xl border bg-white p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-semibold text-black">{isAdmin ? "All meetings" : "Your meetings"}</h2>
          </div>

          {meetings.length === 0 ? (
            <div className="mt-4 text-sm text-black/70">No meetings found.</div>
          ) : (
            <div className="mt-4 space-y-3">
              {meetings.map((m) => {
                const bookedName = profilesById[m.booked_by_id]?.full_name ?? "—";
                const takenName = profilesById[m.attended_by_id]?.full_name ?? "—";

                return (
                  <div key={m.id} className="rounded-2xl border p-4 bg-white">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-9 w-9 rounded-xl border bg-gray-50 flex items-center justify-center text-xs font-semibold">
                          {initials(m.meeting_name)}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold truncate">{m.meeting_name || "Unnamed meeting"}</div>
                          <div className="mt-1 text-xs text-black/60">{fmtDateTimeAU(m.meeting_at)}</div>
                          <div className="mt-1 text-xs text-black/60">
                            Booked: <span className="font-medium text-black">{bookedName}</span> • Taken:{" "}
                            <span className="font-medium text-black">{takenName}</span> • Score:{" "}
                            <span className="font-medium text-black">{m.lead_score ?? 1}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => discardMeeting(m.id)}
                          disabled={savingMeetingId === m.id}
                          className="rounded-xl border px-3 py-2 text-xs bg-white text-black disabled:opacity-60"
                        >
                          Discard
                        </button>

                        <button
                          onClick={() => saveMeetingUpdates(m)}
                          disabled={savingMeetingId === m.id}
                          className="rounded-xl bg-black px-3 py-2 text-xs text-white disabled:opacity-60"
                        >
                          {savingMeetingId === m.id ? "Saving…" : "Save"}
                        </button>
                      </div>
                    </div>

                    {/* Quick edits */}
                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <div className="lg:col-span-2">
                        <label className="text-xs font-medium text-black">Meeting name</label>
                        <input
                          className="mt-1 w-full rounded-xl border px-3 py-2 text-sm text-black"
                          value={m.meeting_name ?? ""}
                          onChange={(e) => patchMeeting(m.id, { meeting_name: e.target.value })}
                        />
                      </div>

                      <div>
                        <label className="text-xs font-medium text-black">Lead score</label>
                        <select
                          className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white text-black"
                          value={m.lead_score ?? 1}
                          onChange={(e) => patchMeeting(m.id, { lead_score: Number(e.target.value) })}
                        >
                          <option value={1}>1</option>
                          <option value={2}>2</option>
                          <option value={3}>3 (Hot)</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-medium text-black">Booked by</label>
                        <select
                          className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white text-black"
                          value={m.booked_by_id}
                          onChange={(e) => patchMeeting(m.id, { booked_by_id: e.target.value })}
                        >
                          {profiles.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.full_name ?? p.id}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-medium text-black">Taken by</label>
                        <select
                          className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white text-black"
                          value={m.attended_by_id}
                          onChange={(e) => patchMeeting(m.id, { attended_by_id: e.target.value })}
                        >
                          {profiles.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.full_name ?? p.id}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="sm:col-span-2 lg:col-span-4">
                        <label className="text-xs font-medium text-black">Outcomes</label>
                        <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <label className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm bg-white">
                            <span className="text-black">Showed up</span>
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={m.showed_up}
                              onChange={(e) => patchMeeting(m.id, { showed_up: e.target.checked })}
                            />
                          </label>

                          <label className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm bg-white">
                            <span className="text-black">Moved to SS2</span>
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={m.moved_to_ss2}
                              onChange={(e) => patchMeeting(m.id, { moved_to_ss2: e.target.checked })}
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {msg && <div className="mt-6 rounded-xl border bg-gray-50 p-3 text-sm text-black">{msg}</div>}
      </div>
    </div>
  );
}