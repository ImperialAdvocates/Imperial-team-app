"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Tone = "red" | "amber" | "green" | "blue";
type RangeMode = "weekly" | "monthly";
type ScopeMode = "team" | "person";

function toneClasses(t: Tone) {
  switch (t) {
    case "red":
      return "border-red-200 bg-red-50 text-red-900";
    case "amber":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "green":
      return "border-green-200 bg-green-50 text-green-900";
    case "blue":
      return "border-blue-200 bg-blue-50 text-blue-900";
  }
}

function melbISO(d: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function normRole(r?: string | null) {
  return (r ?? "").trim().toLowerCase();
}

function n(v: number | null | undefined) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return String(v);
}

function pctRatio(num: number, den: number) {
  if (!den || den <= 0) return "—";
  return `${Math.round((num / den) * 100)}%`;
}

/** Monday-start week in Melbourne time, returned as YYYY-MM-DD */
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

/**
 * Business month:
 * - starts on the 26th
 * - ends (exclusive) on the 26th of next month
 */
function businessMonthRangeISO(now: Date) {
  const nowISO = melbISO(now);
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

  return { startISO: melbISO(start), endExclusiveISO: melbISO(endExclusive) };
}

function fmtRangeLabel(startISO: string, endExclusiveISO: string) {
  const end = new Date(`${endExclusiveISO}T00:00:00`);
  end.setDate(end.getDate() - 1);
  return `${startISO} → ${melbISO(end)}`;
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

function StatCard({
  title,
  value,
  subtitle,
  tone = "blue",
  onClick,
}: {
  title: string;
  value: string;
  subtitle?: string;
  tone?: Tone;
  onClick?: () => void;
}) {
  const clickable = typeof onClick === "function";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border p-4 text-left w-full ${toneClasses(tone)} ${
        clickable ? "hover:opacity-95 active:opacity-90" : "cursor-default"
      }`}
      disabled={!clickable}
    >
      <div className="text-xs font-semibold opacity-80">{title}</div>
      <div className="mt-2 text-3xl font-semibold">{value}</div>
      {subtitle ? <div className="mt-1 text-xs opacity-80">{subtitle}</div> : null}
    </button>
  );
}

type PersonRow = {
  id: string;
  full_name: string | null;
};

export default function AdminHubPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  // Toggles
  const [rangeMode, setRangeMode] = useState<RangeMode>("monthly");
  const [scopeMode, setScopeMode] = useState<ScopeMode>("team");
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [personId, setPersonId] = useState<string>("");

  const todayISO = useMemo(() => melbISO(new Date()), []);

  // Ranges
  const monthly = useMemo(() => businessMonthRangeISO(new Date()), []);
  const weekStartISO = useMemo(() => startOfWeekISO_Melb(new Date()), []);
  const weekly = useMemo(
    () => ({ startISO: weekStartISO, endExclusiveISO: addDaysISO(weekStartISO, 7) }),
    [weekStartISO]
  );

  const activeRange = rangeMode === "monthly" ? monthly : weekly;
  const rangeLabel = useMemo(
    () => fmtRangeLabel(activeRange.startISO, activeRange.endExclusiveISO),
    [activeRange.startISO, activeRange.endExclusiveISO]
  );

  // Meetings range (UTC)
  const rangeStartUtcIso = useMemo(() => melbMidnightToUtcIso(activeRange.startISO), [activeRange.startISO]);
  const rangeEndUtcIso = useMemo(() => melbMidnightToUtcIso(activeRange.endExclusiveISO), [activeRange.endExclusiveISO]);

  // Today range (UTC)
  const todayStartUtcIso = useMemo(() => melbMidnightToUtcIso(todayISO), [todayISO]);
  const todayEndExclusiveUtcIso = useMemo(() => melbMidnightToUtcIso(addDaysISO(todayISO, 1)), [todayISO]);

  // Admin state
  const [myRole, setMyRole] = useState<string>("");
  const [isAdmin, setIsAdmin] = useState(false);

  // KPI
  const [todaySubmitted, setTodaySubmitted] = useState(false);

  // Totals
  const [bookedKpi, setBookedKpi] = useState(0);
  const [meetingsOccurred, setMeetingsOccurred] = useState(0);
  const [shows, setShows] = useState(0);
  const [moved, setMoved] = useState(0);

  // Today totals (hide discarded)
  const [todayMeetings, setTodayMeetings] = useState(0);
  const [todayShows, setTodayShows] = useState(0);

  const scopeLabel = useMemo(() => {
    if (scopeMode === "team") return "Team";
    const p = people.find((x) => x.id === personId);
    return p?.full_name ?? "Person";
  }, [scopeMode, people, personId]);

  const effectivePersonId = useMemo(() => {
    if (scopeMode !== "person") return "";
    if (personId) return personId;
    return people[0]?.id ?? "";
  }, [scopeMode, personId, people]);

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
      // Require admin
      const meRes = await supabase
        .from("profiles")
        .select("id, role, is_admin")
        .eq("id", uid)
        .single();

      if (meRes.error) throw new Error(meRes.error.message);

      const role = normRole(meRes.data?.role);
      const adminFlag = !!meRes.data?.is_admin || role === "admin";
      setMyRole(role);
      setIsAdmin(adminFlag);

      if (!adminFlag) {
        router.push("/hub");
        return;
      }

      // People list (for person toggle)
      const pplRes = await supabase
        .from("profiles")
        .select("id, full_name")
        .order("full_name", { ascending: true });

      if (pplRes.error) throw new Error(pplRes.error.message);

      const ppl = (pplRes.data ?? []) as PersonRow[];
      setPeople(ppl);

      // If person mode and none selected yet, pick first person
      if (scopeMode === "person" && !personId && ppl.length > 0) {
        setPersonId(ppl[0].id);
      }

      const pid = scopeMode === "person" ? (effectivePersonId || ppl[0]?.id || "") : "";

      // Today KPI submitted?
      // - team: show admin's own submission status
      // - person: show selected person's status
      const kpiUid = scopeMode === "person" && pid ? pid : uid;

      const todayKpiRes = await supabase
        .from("daily_kpis")
        .select("id")
        .eq("user_id", kpiUid)
        .eq("entry_date", todayISO)
        .maybeSingle();

      if (todayKpiRes.error) throw new Error(todayKpiRes.error.message);
      setTodaySubmitted(!!todayKpiRes.data);

      // -------------------------
      // Booked KPI (daily_kpis)
      // -------------------------
      let bookedSum = 0;

      let dkQ = supabase
        .from("daily_kpis")
        .select("user_id, entry_date, appointments_booked")
        .gte("entry_date", activeRange.startISO)
        .lt("entry_date", activeRange.endExclusiveISO);

      if (scopeMode === "person" && pid) dkQ = dkQ.eq("user_id", pid);

      const dkRes = await dkQ;
      if (dkRes.error) throw new Error(dkRes.error.message);

      (dkRes.data ?? []).forEach((r: any) => {
        bookedSum += Number(r.appointments_booked ?? 0) || 0;
      });

      setBookedKpi(bookedSum);

      // -------------------------
      // Meetings (simplified schema)
      // Period totals include discarded meetings (history stays)
      // Scope=person uses attended_by_id (taker-owned outcomes)
      // -------------------------
      let mtgQ = supabase
        .from("meetings")
        .select("meeting_at, attended_by_id, showed_up, moved_to_ss2, discarded_at")
        .gte("meeting_at", rangeStartUtcIso)
        .lt("meeting_at", rangeEndUtcIso);

      if (scopeMode === "person" && pid) mtgQ = mtgQ.eq("attended_by_id", pid);

      const mtgRes = await mtgQ;
      if (mtgRes.error) throw new Error(mtgRes.error.message);

      const nowMs = Date.now();
      const occurred = (mtgRes.data ?? []).filter((m: any) => {
        const t = Date.parse(m.meeting_at);
        return Number.isFinite(t) && t <= nowMs;
      });

      const occurredCount = occurred.length;
      const showsCount = occurred.filter((m: any) => m.showed_up === true).length;
      const movedCount = occurred.filter((m: any) => m.moved_to_ss2 === true).length;

      setMeetingsOccurred(occurredCount);
      setShows(showsCount);
      setMoved(movedCount);

      // -------------------------
      // Today meetings (hide discarded)
      // Scope=person uses attended_by_id
      // -------------------------
      let todayQ = supabase
        .from("meetings")
        .select("id, showed_up, meeting_at, attended_by_id, discarded_at")
        .gte("meeting_at", todayStartUtcIso)
        .lt("meeting_at", todayEndExclusiveUtcIso)
        .is("discarded_at", null);

      if (scopeMode === "person" && pid) todayQ = todayQ.eq("attended_by_id", pid);

      const todayRes = await todayQ;
      if (todayRes.error) throw new Error(todayRes.error.message);

      const todayList = todayRes.data ?? [];
      setTodayMeetings(todayList.length);
      setTodayShows(todayList.filter((m: any) => m.showed_up === true).length);

      setLoading(false);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to load admin overview.");
      setLoading(false);
    }
  }, [
    router,
    todayISO,
    activeRange.startISO,
    activeRange.endExclusiveISO,
    rangeStartUtcIso,
    rangeEndUtcIso,
    todayStartUtcIso,
    todayEndExclusiveUtcIso,
    rangeMode,
    scopeMode,
    personId,
    effectivePersonId,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const showRate = pctRatio(shows, meetingsOccurred);
  const moveRate = pctRatio(moved, shows);
  const kpiTone: Tone = todaySubmitted ? "green" : "amber";

  if (loading) return <div className="p-6 text-black">Loading…</div>;

  return (
    <div className="min-h-[100dvh] bg-gray-50 p-4 text-black">
      <div className="mx-auto w-full max-w-md">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="text-xs text-black/60">Admin</div>
            <h1 className="text-2xl font-semibold">Admin Overview</h1>
            <div className="mt-1 text-xs text-black/60">
              Scope: <b>{scopeLabel}</b> • Period ({rangeMode}): {rangeLabel} • Today: {todayISO}
            </div>
            <div className="mt-1 text-[11px] text-black/50">
              Logged in as: <span className="font-medium">{myRole || "admin"}</span>
              {isAdmin ? " (admin)" : ""}
            </div>
            <div className="mt-1 text-[11px] text-black/50">
              Period totals include discarded meetings. Today totals hide discarded.
              {scopeMode === "person" ? " Person scope attributes outcomes by attended_by_id." : ""}
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={() => router.push("/hub")} className="rounded-xl border bg-white px-3 py-2 text-xs">
              Hub
            </button>
            <button onClick={load} className="rounded-xl border bg-white px-3 py-2 text-xs">
              Refresh
            </button>
          </div>
        </div>

        {/* RANGE TOGGLE */}
        <div className="mb-3 rounded-2xl border bg-white p-2 flex gap-2">
          <button
            type="button"
            onClick={() => setRangeMode("weekly")}
            className={`flex-1 rounded-xl px-3 py-2 text-sm border ${
              rangeMode === "weekly" ? "bg-black text-white" : "bg-white text-black"
            }`}
          >
            Weekly
          </button>
          <button
            type="button"
            onClick={() => setRangeMode("monthly")}
            className={`flex-1 rounded-xl px-3 py-2 text-sm border ${
              rangeMode === "monthly" ? "bg-black text-white" : "bg-white text-black"
            }`}
          >
            Monthly
          </button>
        </div>

        {/* SCOPE TOGGLE */}
        <div className="mb-3 rounded-2xl border bg-white p-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setScopeMode("team")}
              className={`flex-1 rounded-xl px-3 py-2 text-sm border ${
                scopeMode === "team" ? "bg-black text-white" : "bg-white text-black"
              }`}
            >
              Team
            </button>
            <button
              type="button"
              onClick={() => setScopeMode("person")}
              className={`flex-1 rounded-xl px-3 py-2 text-sm border ${
                scopeMode === "person" ? "bg-black text-white" : "bg-white text-black"
              }`}
            >
              Person
            </button>
          </div>

          {scopeMode === "person" ? (
            <div className="mt-2">
              <select
                className="w-full rounded-xl border px-3 py-2 text-sm bg-white"
                value={effectivePersonId}
                onChange={(e) => setPersonId(e.target.value)}
              >
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name ?? p.id}
                  </option>
                ))}
              </select>
              <div className="mt-1 text-[11px] text-black/50">
                Person scope uses <b>meetings.attended_by_id</b> for shows/moved.
              </div>
            </div>
          ) : null}
        </div>

        {/* CARDS */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <StatCard
            title="Today KPI"
            value={todaySubmitted ? "✅" : "—"}
            subtitle={todaySubmitted ? "Submitted" : "Not submitted"}
            tone={kpiTone}
            onClick={() => router.push("/daily-kpis")}
          />

          <StatCard
            title="Meetings today"
            value={n(todayMeetings)}
            subtitle={`Shows today: ${n(todayShows)}`}
            tone="blue"
            onClick={() => router.push("/meetings")}
          />
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <StatCard
            title="Booked"
            value={n(bookedKpi)}
            subtitle={`Period: ${rangeLabel}`}
            tone="green"
            onClick={() => router.push("/daily-kpis")}
          />

          <StatCard
            title="Meetings on calendar"
            value={n(meetingsOccurred)}
            subtitle={`Show rate: ${showRate}`}
            tone="blue"
            onClick={() => router.push("/meetings")}
          />
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <StatCard
            title="Shows"
            value={n(shows)}
            subtitle={`Moved: ${n(moved)} • Move rate: ${moveRate}`}
            tone="green"
            onClick={() => router.push("/meetings")}
          />

          <StatCard
            title="Moved to SS2"
            value={n(moved)}
            subtitle={`From shows: ${n(shows)} • ${moveRate}`}
            tone={shows > 0 && moved === 0 ? "amber" : "green"}
            onClick={() => router.push("/meetings")}
          />
        </div>

        {/* ADMIN TOOLS */}
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-sm font-semibold">Admin tools</div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              onClick={() => router.push("/meetings")}
              className="rounded-xl border bg-white px-3 py-3 text-left"
            >
              <div className="text-sm font-semibold">Meetings</div>
              <div className="text-xs text-black/60 mt-1">Outcomes + edits</div>
            </button>

            <button
              onClick={() => router.push("/daily-kpis")}
              className="rounded-xl border bg-white px-3 py-3 text-left"
            >
              <div className="text-sm font-semibold">Daily KPIs</div>
              <div className="text-xs text-black/60 mt-1">Appointments booked</div>
            </button>

            <button
              onClick={() => router.push("/admin/kpi-templates")}
              className="rounded-xl border bg-white px-3 py-3 text-left"
            >
              <div className="text-sm font-semibold">KPI Setup</div>
              <div className="text-xs text-black/60 mt-1">Weekly targets</div>
            </button>

            <button
              onClick={() => router.push("/admin/performance")}
              className="rounded-xl border bg-white px-3 py-3 text-left"
            >
              <div className="text-sm font-semibold">Performance</div>
              <div className="text-xs text-black/60 mt-1">Per-person breakdown</div>
            </button>
          </div>
        </div>

        {msg && <div className="mt-4 rounded-xl border bg-gray-50 p-3 text-sm text-black">{msg}</div>}
      </div>
    </div>
  );
}