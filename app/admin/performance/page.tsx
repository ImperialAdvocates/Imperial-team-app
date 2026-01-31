"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

/* ---------------- Types ---------------- */

type UserRow = {
  id: string;
  full_name: string | null;
};

type MeetingRow = {
  id: string;
  meeting_at: string; // timestamptz
  booked_by_id: string;
  attended_by_id: string;
  showed_up: boolean;
  moved_to_ss2: boolean;
  discarded_at: string | null;
};

/* ---------------- Date helpers (Melbourne) ---------------- */

function melbISO(d: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function startOfWeekISO_Melb(today: Date) {
  const local = new Date(today);
  const day = local.getDay(); // 0 Sun .. 6 Sat
  const diffToMon = (day + 6) % 7;
  local.setDate(local.getDate() - diffToMon);
  local.setHours(0, 0, 0, 0);
  return melbISO(local);
}

function addDaysISO(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return melbISO(d);
}

function normRole(r?: string | null) {
  return (r ?? "").trim().toLowerCase();
}

/**
 * Convert a Melbourne “YYYY-MM-DD” midnight into a UTC ISO string using the
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

/* ---------------- Formatting helpers ---------------- */

function n(v: number | null | undefined) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return String(v);
}

function pct(num: number, den: number) {
  if (!den || den <= 0) return "—";
  return `${Math.round((num / den) * 100)}%`;
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border bg-white p-4">
      <div className="text-xs font-semibold text-black/60">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-black">{value}</div>
      {sub ? <div className="mt-1 text-xs text-black/50">{sub}</div> : null}
    </div>
  );
}

/* ---------------- Component ---------------- */

export default function AdminPerformancePage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [pageMsg, setPageMsg] = useState<string | null>(null);

  const [users, setUsers] = useState<UserRow[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("");

  // weeks list (last 8)
  const currentWeekStartISO = useMemo(() => startOfWeekISO_Melb(new Date()), []);
  const [weekOptions, setWeekOptions] = useState<string[]>([]);
  const [focusWeekStart, setFocusWeekStart] = useState<string>("");

  const selectedUserName = useMemo(() => {
    const u = users.find((x) => x.id === selectedUserId);
    return u?.full_name ?? "Team member";
  }, [users, selectedUserId]);

  // KPI (from daily_kpis)
  const [bookedKpi, setBookedKpi] = useState(0); // appointments_booked

  // Meetings outcomes (from simplified meetings)
  const [occurredBookedBy, setOccurredBookedBy] = useState(0);
  const [showsBookedBy, setShowsBookedBy] = useState(0);
  const [ss2BookedBy, setSs2BookedBy] = useState(0);

  const [takenShowed, setTakenShowed] = useState(0); // taken = attended_by AND showed_up
  const [ss2Taken, setSs2Taken] = useState(0);

  // init admin + staff + week list
  useEffect(() => {
    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const session = sessionData.session;
        if (!session) {
          router.push("/login");
          return;
        }

        const meRes = await supabase
          .from("profiles")
          .select("id, role, is_admin")
          .eq("id", session.user.id)
          .single();

        if (meRes.error) throw new Error(meRes.error.message);

        const okAdmin = normRole(meRes.data?.role) === "admin" || !!meRes.data?.is_admin;
        if (!okAdmin) {
          router.push("/hub");
          return;
        }

        const staffRes = await supabase
          .from("profiles")
          .select("id, full_name")
          .order("full_name", { ascending: true });

        if (staffRes.error) throw new Error(staffRes.error.message);

        const staff = (staffRes.data ?? []) as UserRow[];
        setUsers(staff);
        if (staff.length > 0) setSelectedUserId(staff[0].id);

        // build last 8 week starts
        const opts: string[] = [];
        for (let i = 0; i < 8; i++) {
          const base = new Date(`${currentWeekStartISO}T00:00:00`);
          base.setDate(base.getDate() - i * 7);
          opts.push(melbISO(base));
        }
        setWeekOptions(opts);
        setFocusWeekStart(opts[0] ?? currentWeekStartISO);

        setLoading(false);
      } catch (e: any) {
        setPageMsg(e?.message ?? "Failed to load performance page.");
        setLoading(false);
      }
    })();
  }, [router, currentWeekStartISO]);

  const loadWeek = useCallback(async () => {
    if (!selectedUserId || !focusWeekStart) return;

    setPageMsg(null);

    try {
      const weekStartISO = focusWeekStart;
      const weekEndExclusiveISO = addDaysISO(weekStartISO, 7);

      // Meetings range in UTC (DST-safe)
      const weekStartUtcIso = melbMidnightToUtcIso(weekStartISO);
      const weekEndUtcIso = melbMidnightToUtcIso(weekEndExclusiveISO);

      // ---------- KPI: appointments_booked from daily_kpis ----------
      const dkRes = await supabase
        .from("daily_kpis")
        .select("appointments_booked")
        .eq("user_id", selectedUserId)
        .gte("entry_date", weekStartISO)
        .lt("entry_date", weekEndExclusiveISO);

      if (dkRes.error) throw new Error(dkRes.error.message);

      let booked = 0;
      (dkRes.data ?? []).forEach((r: any) => {
        booked += Number(r.appointments_booked ?? 0) || 0;
      });
      setBookedKpi(booked);

      // ---------- Meetings outcomes (simplified schema) ----------
      // Include discarded rows in totals (history), but only count occurred meetings.
      const mRes = await supabase
        .from("meetings")
        .select("id, meeting_at, booked_by_id, attended_by_id, showed_up, moved_to_ss2, discarded_at")
        .gte("meeting_at", weekStartUtcIso)
        .lt("meeting_at", weekEndUtcIso);

      if (mRes.error) throw new Error(mRes.error.message);

      const all = (mRes.data ?? []) as MeetingRow[];

      const nowMs = Date.now();
      const occurred = all.filter((m) => {
        const t = Date.parse(m.meeting_at);
        return Number.isFinite(t) && t <= nowMs;
      });

      // Booked-by attribution (booked_by_id)
      const bookedBy = occurred.filter((m) => m.booked_by_id === selectedUserId);
      const bookedByOccurred = bookedBy.length;
      const bookedByShows = bookedBy.filter((m) => m.showed_up === true).length;
      const bookedBySS2 = bookedBy.filter((m) => m.moved_to_ss2 === true).length;

      setOccurredBookedBy(bookedByOccurred);
      setShowsBookedBy(bookedByShows);
      setSs2BookedBy(bookedBySS2);

      // Taken-by attribution (attended_by_id) — ONLY meetings that showed up
      const takenRows = occurred.filter(
        (m) => m.attended_by_id === selectedUserId && m.showed_up === true
      );
      const takenShowedCount = takenRows.length;
      const takenSS2Count = takenRows.filter((m) => m.moved_to_ss2 === true).length;

      setTakenShowed(takenShowedCount);
      setSs2Taken(takenSS2Count);
    } catch (e: any) {
      setPageMsg(e?.message ?? "Failed to load week stats.");

      setBookedKpi(0);

      setOccurredBookedBy(0);
      setShowsBookedBy(0);
      setSs2BookedBy(0);

      setTakenShowed(0);
      setSs2Taken(0);
    }
  }, [selectedUserId, focusWeekStart]);

  useEffect(() => {
    loadWeek();
  }, [loadWeek]);

  if (loading) return <div className="p-6 text-black">Loading…</div>;

  const weekEndLabel = focusWeekStart ? addDaysISO(focusWeekStart, 6) : "—";

  // Your model:
  // show rate = shows (booked_by) / booked KPI (appointments_booked)
  const showRateVsBookedKpi = pct(showsBookedBy, bookedKpi);

  // sanity:
  const showRateVsOccurred = pct(showsBookedBy, occurredBookedBy);

  // move rate (taken-by) = moved / showed (taken-by)
  const moveRateTaken = pct(ss2Taken, takenShowed);

  return (
    <div className="min-h-[100dvh] bg-gray-50 p-4 text-black">
      <div className="mx-auto w-full max-w-md">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="text-xs text-black/60">Admin</div>
            <h1 className="text-2xl font-semibold">Performance</h1>
            <div className="mt-1 text-xs text-black/60">
              {selectedUserName} • {focusWeekStart || "—"} → {weekEndLabel}
            </div>
            <div className="mt-1 text-[11px] text-black/50">
              KPI: <code>daily_kpis.appointments_booked</code> • Meetings: booked/taken outcomes
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={loadWeek} className="rounded-xl border bg-white px-3 py-2 text-xs">
              Refresh
            </button>
            <button onClick={() => router.push("/admin")} className="rounded-xl border bg-white px-3 py-2 text-xs">
              Back
            </button>
          </div>
        </div>

        {/* Controls */}
        <div className="rounded-2xl border bg-white p-4 mb-4">
          <div className="grid gap-3">
            <div>
              <div className="text-xs font-semibold text-black/60">Team member</div>
              <select
                className="mt-2 w-full rounded-xl border px-3 py-2 bg-white text-sm"
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name ?? u.id}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="text-xs font-semibold text-black/60">Week</div>
              <select
                className="mt-2 w-full rounded-xl border px-3 py-2 bg-white text-sm"
                value={focusWeekStart}
                onChange={(e) => setFocusWeekStart(e.target.value)}
              >
                {weekOptions.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </div>

            <div className="text-[11px] text-black/50 leading-relaxed">
              • “Booked-by” uses <code>meetings.booked_by_id</code> (setter attribution). <br />
              • “Taken-by” uses <code>meetings.attended_by_id</code> but only counts those that <b>showed up</b>. <br />
              • Only meetings that already happened are counted.
            </div>
          </div>
        </div>

        {/* Top stats */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <Stat label="Appointments booked (KPI)" value={n(bookedKpi)} sub="From daily_kpis" />
          <Stat label="Show rate (vs KPI booked)" value={showRateVsBookedKpi} sub="Shows ÷ KPI booked" />
        </div>

        {/* Booked-by attribution */}
        <div className="rounded-2xl border bg-white p-4 mb-3">
          <div className="text-sm font-semibold text-black">Booked-by outcomes</div>
          <div className="mt-1 text-xs text-black/60">Meetings booked by this person (occurred only)</div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <Stat
              label="Meetings occurred"
              value={n(occurredBookedBy)}
              sub={`Show rate (vs occurred): ${showRateVsOccurred}`}
            />
            <Stat label="Shows" value={n(showsBookedBy)} sub="showed_up = true" />
            <Stat
              label="Moved to SS2"
              value={n(ss2BookedBy)}
              sub={occurredBookedBy ? `Rate: ${pct(ss2BookedBy, occurredBookedBy)}` : "Rate: —"}
            />
            <div className="rounded-2xl border bg-gray-50 p-4">
              <div className="text-xs font-semibold text-black/60">Quick</div>
              <div className="mt-3 grid gap-2">
                <button
                  onClick={() => router.push("/meetings")}
                  className="rounded-xl border bg-white px-3 py-2 text-xs text-left"
                >
                  Open meetings
                  <div className="text-[11px] text-black/50 mt-1">Edit booked-by + outcomes</div>
                </button>
                <button
                  onClick={() => router.push("/daily-kpis")}
                  className="rounded-xl border bg-white px-3 py-2 text-xs text-left"
                >
                  Open KPI entry
                  <div className="text-[11px] text-black/50 mt-1">Enter appointments booked</div>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Taken-by attribution */}
        <div className="rounded-2xl border bg-white p-4 mb-4">
          <div className="text-sm font-semibold text-black">Taken-by outcomes</div>
          <div className="mt-1 text-xs text-black/60">Meetings taken by this person (only those that showed up)</div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <Stat label="Taken (showed up)" value={n(takenShowed)} sub="attended_by + showed_up" />
            <Stat label="Moved to SS2" value={n(ss2Taken)} sub={`Move rate: ${moveRateTaken}`} />
          </div>
        </div>

        {pageMsg && <div className="mt-4 rounded-xl border bg-gray-50 p-3 text-sm text-black">{pageMsg}</div>}
      </div>
    </div>
  );
}