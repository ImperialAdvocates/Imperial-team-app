"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { AppShell, GlassCard, NeonButton, NeonBadge } from "@/app/Components/ui/app-ui";

type RangeMode = "weekly" | "monthly";
type ScopeMode = "team" | "person";

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
  const rangeStartUtcIso = useMemo(
    () => melbMidnightToUtcIso(activeRange.startISO),
    [activeRange.startISO]
  );
  const rangeEndUtcIso = useMemo(
    () => melbMidnightToUtcIso(activeRange.endExclusiveISO),
    [activeRange.endExclusiveISO]
  );

  // Today range (UTC)
  const todayStartUtcIso = useMemo(() => melbMidnightToUtcIso(todayISO), [todayISO]);
  const todayEndExclusiveUtcIso = useMemo(
    () => melbMidnightToUtcIso(addDaysISO(todayISO, 1)),
    [todayISO]
  );

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

      if (scopeMode === "person" && !personId && ppl.length > 0) {
        setPersonId(ppl[0].id);
      }

      const pid = scopeMode === "person" ? (effectivePersonId || ppl[0]?.id || "") : "";

      // Today KPI submitted?
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
      // Period totals include discarded meetings
      // Scope=person uses attended_by_id
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

      setMeetingsOccurred(occurred.length);
      setShows(occurred.filter((m: any) => m.showed_up === true).length);
      setMoved(occurred.filter((m: any) => m.moved_to_ss2 === true).length);

      // -------------------------
      // Today meetings (hide discarded)
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

  if (loading) return <div className="p-6 text-white">Loading…</div>;

  return (
    <AppShell
      title="Admin Overview"
      subtitle={`Scope: ${scopeLabel} • Period (${rangeMode}): ${rangeLabel} • Today: ${todayISO}`}
      maxWidth="max-w-md"
      right={
        <>
          <NeonButton variant="secondary" onClick={() => router.push("/hub")}>
            Hub
          </NeonButton>
          <NeonButton variant="secondary" onClick={load}>
            Refresh
          </NeonButton>
        </>
      }
    >
      <div className="mb-4 text-[11px] text-white/55">
        Logged in as: <span className="text-white/80 font-medium">{myRole || "admin"}</span>
        {isAdmin ? " (admin)" : ""} • Period totals include discarded meetings. Today totals hide discarded.
        {scopeMode === "person" ? " Person scope attributes outcomes by attended_by_id." : ""}
      </div>

      {/* RANGE TOGGLE */}
      <GlassCard className="mb-3" glow>
        <div className="flex gap-2">
          <NeonButton
            type="button"
            className="flex-1"
            variant={rangeMode === "weekly" ? "primary" : "secondary"}
            onClick={() => setRangeMode("weekly")}
          >
            Weekly
          </NeonButton>
          <NeonButton
            type="button"
            className="flex-1"
            variant={rangeMode === "monthly" ? "primary" : "secondary"}
            onClick={() => setRangeMode("monthly")}
          >
            Monthly
          </NeonButton>
        </div>
      </GlassCard>

      {/* SCOPE TOGGLE */}
      <GlassCard className="mb-3" glow>
        <div className="flex gap-2">
          <NeonButton
            type="button"
            className="flex-1"
            variant={scopeMode === "team" ? "primary" : "secondary"}
            onClick={() => setScopeMode("team")}
          >
            Team
          </NeonButton>
          <NeonButton
            type="button"
            className="flex-1"
            variant={scopeMode === "person" ? "primary" : "secondary"}
            onClick={() => setScopeMode("person")}
          >
            Person
          </NeonButton>
        </div>

        {scopeMode === "person" ? (
          <div className="mt-3">
            <select
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
              value={effectivePersonId}
              onChange={(e) => setPersonId(e.target.value)}
            >
              {people.map((p) => (
                <option key={p.id} value={p.id} className="text-black">
                  {p.full_name ?? p.id}
                </option>
              ))}
            </select>

            <div className="mt-2 text-[11px] text-white/55">
              Person scope uses <b>meetings.attended_by_id</b> for shows/moved.
            </div>
          </div>
        ) : null}
      </GlassCard>

      {/* TOP CARDS */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <GlassCard glow>
          <div className="flex items-center justify-between">
            <div className="text-xs text-white/60 font-semibold">Today KPI</div>
            <NeonBadge tone={todaySubmitted ? "green" : "amber"}>
              {todaySubmitted ? "Submitted" : "Not submitted"}
            </NeonBadge>
          </div>
          <div className="mt-2 text-3xl font-semibold text-white">{todaySubmitted ? "✅" : "—"}</div>
          <div className="mt-3">
            <NeonButton variant="secondary" onClick={() => router.push("/daily-kpis")} className="w-full">
              Open Daily KPIs
            </NeonButton>
          </div>
        </GlassCard>

        <GlassCard glow>
          <div className="text-xs text-white/60 font-semibold">Meetings today</div>
          <div className="mt-2 text-3xl font-semibold text-white">{n(todayMeetings)}</div>
          <div className="mt-1 text-xs text-white/55">Shows today: {n(todayShows)}</div>
          <div className="mt-3">
            <NeonButton variant="secondary" onClick={() => router.push("/meetings")} className="w-full">
              Open Meetings
            </NeonButton>
          </div>
        </GlassCard>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <GlassCard>
          <div className="text-xs text-white/60 font-semibold">Booked (KPI)</div>
          <div className="mt-2 text-3xl font-semibold text-white">{n(bookedKpi)}</div>
          <div className="mt-1 text-xs text-white/55">Period: {rangeLabel}</div>
        </GlassCard>

        <GlassCard>
          <div className="text-xs text-white/60 font-semibold">Meetings occurred</div>
          <div className="mt-2 text-3xl font-semibold text-white">{n(meetingsOccurred)}</div>
          <div className="mt-1 text-xs text-white/55">Show rate: {showRate}</div>
        </GlassCard>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <GlassCard>
          <div className="text-xs text-white/60 font-semibold">Shows</div>
          <div className="mt-2 text-3xl font-semibold text-white">{n(shows)}</div>
          <div className="mt-1 text-xs text-white/55">
            Moved: {n(moved)} • Move rate: {moveRate}
          </div>
        </GlassCard>

        <GlassCard>
          <div className="text-xs text-white/60 font-semibold">Moved to SS2</div>
          <div className="mt-2 text-3xl font-semibold text-white">{n(moved)}</div>
          <div className="mt-1 text-xs text-white/55">
            From shows: {n(shows)} • {moveRate}
          </div>
        </GlassCard>
      </div>

      {/* ADMIN TOOLS */}
      <GlassCard glow>
        <div className="text-sm font-semibold text-white">Admin tools</div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <NeonButton variant="secondary" onClick={() => router.push("/meetings")} className="w-full">
            Meetings
          </NeonButton>

          <NeonButton variant="secondary" onClick={() => router.push("/daily-kpis")} className="w-full">
            Daily KPIs
          </NeonButton>

          <NeonButton variant="secondary" onClick={() => router.push("/admin/kpi-templates")} className="w-full">
            KPI Setup
          </NeonButton>

          <NeonButton variant="secondary" onClick={() => router.push("/admin/performance")} className="w-full">
            Performance
          </NeonButton>
        </div>
      </GlassCard>

      {msg ? (
        <GlassCard className="mt-4">
          <div className="text-sm text-white/80">{msg}</div>
        </GlassCard>
      ) : null}
    </AppShell>
  );
}