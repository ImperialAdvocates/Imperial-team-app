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
  meeting_at: string;
  booked_by_id: string | null;
  attended_by_id: string | null;
  showed_up: boolean | null;
  moved_to_ss2: boolean | null;
  is_closed: boolean | null;
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

  // KPI (manual)
  const [bookedKpi, setBookedKpi] = useState(0); // appointments_booked

  // Outcomes (automatic, from meetings) — two attribution angles
  const [occurredBookedBy, setOccurredBookedBy] = useState(0);
  const [showsBookedBy, setShowsBookedBy] = useState(0);
  const [ss2BookedBy, setSs2BookedBy] = useState(0);
  const [closedBookedBy, setClosedBookedBy] = useState(0);

  const [taken, setTaken] = useState(0);
  const [ss2Taken, setSs2Taken] = useState(0);
  const [closedTaken, setClosedTaken] = useState(0);

  // init admin + staff
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
      const weekStart = focusWeekStart;
      const weekEndExclusive = addDaysISO(weekStart, 7);

      // ---------- KPI: appointments_booked (manual) ----------
      const subsRes = await supabase
        .from("kpi_daily_submissions")
        .select("id")
        .eq("user_id", selectedUserId)
        .gte("entry_date", weekStart)
        .lt("entry_date", weekEndExclusive);

      if (subsRes.error) throw new Error(subsRes.error.message);

      const submissionIds = (subsRes.data ?? []).map((s: any) => s.id);
      let booked = 0;

      if (submissionIds.length > 0) {
        // map field_id -> key
        const { data: fields, error: fErr } = await supabase.from("kpi_fields").select("id, key");
        if (fErr) throw new Error(fErr.message);

        const keyById: Record<string, string> = {};
        (fields ?? []).forEach((f: any) => (keyById[f.id] = f.key));

        const valsRes = await supabase
          .from("kpi_daily_values")
          .select("submission_id, field_id, field_key, value_text")
          .in("submission_id", submissionIds);

        if (valsRes.error) throw new Error(valsRes.error.message);

        (valsRes.data ?? []).forEach((v: any) => {
          const key = String(v.field_key ?? keyById[v.field_id] ?? "");
          if (key !== "appointments_booked") return;

          const num = Number(String(v.value_text ?? "").trim());
          if (!Number.isNaN(num)) booked += num;
        });
      }

      setBookedKpi(booked);

      // ---------- Meetings outcomes (automatic) ----------
      // Use Melbourne week window. (Matches your other pages: +11 hardcode.)
      const startMelb = new Date(`${weekStart}T00:00:00+11:00`);
      const endMelb = new Date(`${weekEndExclusive}T00:00:00+11:00`);

      const mRes = await supabase
  .from("meetings")
  .select("id, meeting_at, booked_by_id, attended_by_id, showed_up, moved_to_ss2, is_closed, discarded_at")
  .gte("meeting_at", startMelb.toISOString())
  .lt("meeting_at", endMelb.toISOString());

      if (mRes.error) throw new Error(mRes.error.message);

      const all = (mRes.data ?? []) as MeetingRow[];

      // Count only meetings that have already happened
      const nowMs = Date.now();
const occurred = all.filter((m) => {
  const t = Date.parse(m.meeting_at);
  return Number.isFinite(t) && t <= nowMs;
});

      // Booked-by attribution (setter attribution)
      const bookedBy = occurred.filter((m) => m.booked_by_id === selectedUserId);
      const bookedByOccurred = bookedBy.length;
      const bookedByShows = bookedBy.filter((m) => !!m.showed_up).length;
      const bookedBySS2 = bookedBy.filter((m) => !!m.moved_to_ss2).length;
      const bookedByClosed = bookedBy.filter((m) => !!m.is_closed).length;

      setOccurredBookedBy(bookedByOccurred);
      setShowsBookedBy(bookedByShows);
      setSs2BookedBy(bookedBySS2);
      setClosedBookedBy(bookedByClosed);

      // Taken-by attribution (closer attribution) — only count taken if showed up
      const takenRows = occurred.filter((m) => m.attended_by_id === selectedUserId && !!m.showed_up);
      const takenCount = takenRows.length;
      const takenSS2 = takenRows.filter((m) => !!m.moved_to_ss2).length;
      const takenClosed = takenRows.filter((m) => !!m.is_closed).length;

      setTaken(takenCount);
      setSs2Taken(takenSS2);
      setClosedTaken(takenClosed);
    } catch (e: any) {
      setPageMsg(e?.message ?? "Failed to load week stats.");

      setBookedKpi(0);

      setOccurredBookedBy(0);
      setShowsBookedBy(0);
      setSs2BookedBy(0);
      setClosedBookedBy(0);

      setTaken(0);
      setSs2Taken(0);
      setClosedTaken(0);
    }
  }, [selectedUserId, focusWeekStart]);

  useEffect(() => {
    loadWeek();
  }, [loadWeek]);

  if (loading) return <div className="p-6 text-black">Loading…</div>;

  const weekEndLabel = focusWeekStart ? addDaysISO(focusWeekStart, 6) : "—";

  // ✅ your chosen show rate model:
  // show rate = shows / KPI booked
  const showRateVsBooked = pct(showsBookedBy, bookedKpi);

  // sanity show rate:
  const showRateVsOccurred = pct(showsBookedBy, occurredBookedBy);

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
              Manual: <code>appointments_booked</code> • Automatic: meetings outcomes
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
              “Shows / SS2 / Closed (Booked by)” are attributed by <code>meetings.booked_by_id</code>. <br />
              “Taken / SS2 / Closed (Taken by)” are attributed by <code>meetings.attended_by_id</code> (only if showed up). <br />
              Outcomes only count for meetings that have already happened.
            </div>
          </div>
        </div>

        {/* Top stats */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <Stat label="Appointments booked (KPI)" value={n(bookedKpi)} sub="Manual entry" />
          <Stat label="Show rate (vs booked KPI)" value={showRateVsBooked} sub="Shows ÷ KPI booked" />
        </div>

        {/* Booked-by attribution (setter attribution) */}
        <div className="rounded-2xl border bg-white p-4 mb-3">
          <div className="text-sm font-semibold text-black">Booked-by outcomes</div>
          <div className="mt-1 text-xs text-black/60">Meetings booked by this person (that already occurred)</div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <Stat label="Meetings occurred" value={n(occurredBookedBy)} sub={`Show rate (vs occurred): ${showRateVsOccurred}`} />
            <Stat label="Shows" value={n(showsBookedBy)} sub="showed_up = true" />
            <Stat label="Moved to SS2" value={n(ss2BookedBy)} sub={occurredBookedBy ? `Rate: ${pct(ss2BookedBy, occurredBookedBy)}` : "Rate: —"} />
            <Stat label="Closed" value={n(closedBookedBy)} sub={occurredBookedBy ? `Rate: ${pct(closedBookedBy, occurredBookedBy)}` : "Rate: —"} />
          </div>
        </div>

        {/* Taken-by attribution (closer attribution) */}
        <div className="rounded-2xl border bg-white p-4 mb-4">
          <div className="text-sm font-semibold text-black">Taken-by outcomes</div>
          <div className="mt-1 text-xs text-black/60">Meetings taken by this person (only those that showed up)</div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <Stat label="Meetings taken" value={n(taken)} sub="attended_by + showed_up" />
            <Stat label="Moved to SS2" value={n(ss2Taken)} sub={taken ? `Rate: ${pct(ss2Taken, taken)}` : "Rate: —"} />
            <Stat label="Closed" value={n(closedTaken)} sub={taken ? `Rate: ${pct(closedTaken, taken)}` : "Rate: —"} />
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

        {pageMsg && <div className="mt-4 rounded-xl border bg-gray-50 p-3 text-sm text-black">{pageMsg}</div>}
      </div>
    </div>
  );
}