"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

/* ---------------- Types ---------------- */

type AlertRow = {
  severity: "green" | "amber" | "red";
  reason: string;
  acknowledged_at: string | null;
  meta: unknown;
};

type WeekBlock = {
  weekStart: string; // YYYY-MM-DD (Mon, Melbourne)
  weekEndExclusive: string; // YYYY-MM-DD (next Mon, Melbourne)
  totals: Record<string, number>; // key -> total
  alerts: AlertRow[];
};

type DayBlock = {
  date: string; // YYYY-MM-DD
  totals: Record<string, number>; // key -> total
};

type ChartPoint = {
  week: string; // MM-DD
  weekStartISO: string; // YYYY-MM-DD
  dials: number;
  conversations: number;
  appointments: number;
  contactRate: number; // %
  bookingRate: number; // %
};

type Benchmarks = {
  minDialsPerWeek: number;
  minContactRate: number; // %
  minBookingRate: number; // %
};

const BENCHMARKS: Record<"setter" | "closer", Benchmarks> = {
  setter: { minDialsPerWeek: 250, minContactRate: 8, minBookingRate: 15 },
  closer: { minDialsPerWeek: 120, minContactRate: 10, minBookingRate: 20 },
};

/**
 * Update aliases to match your KPI keys in kpi_fields.key
 */
const KPI_ALIASES = {
  dials: ["dials", "dials_made"],
  conversations: ["conversations", "contacts", "connects"],
  appointments_booked: ["appointments_booked", "appointments", "bookings"],
};

/* ---------------- Date helpers (Melbourne) ---------------- */

function toISODateMelb(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function melbWeekStartDate(d: Date): Date {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // Monday=0
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return toISODateMelb(d);
}

/* ---------------- KPI helpers ---------------- */

function pct(numerator: number, denominator: number) {
  if (!denominator || denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function deltaPct(current: number, previous: number) {
  if (previous === 0) {
    if (current === 0) return 0;
    return 100;
  }
  return Math.round((((current - previous) / previous) * 100) * 10) / 10;
}

function labelDelta(d: number) {
  if (d > 0) return `↑ ${d}%`;
  if (d < 0) return `↓ ${Math.abs(d)}%`;
  return "→ 0%";
}

function badgeClass(d: number) {
  if (d >= 10) return "bg-green-50";
  if (d <= -10) return "bg-red-50";
  return "bg-amber-50";
}

function metricDelta(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Math.round((((current - previous) / previous) * 100) * 10) / 10;
}

function numBadgeClass(d: number) {
  if (d >= 10) return "bg-green-50";
  if (d <= -10) return "bg-red-50";
  return "bg-amber-50";
}

function getTotalByAliases(totals: Record<string, number>, aliases: string[]) {
  for (const k of aliases) {
    if (totals[k] !== undefined) return totals[k] ?? 0;
  }
  return 0;
}

function diagnoseWeek(
  totals: Record<string, number>,
  contactRate: number,
  bookingRate: number,
  bm: Benchmarks
) {
  const dials = getTotalByAliases(totals, KPI_ALIASES.dials);

  if (dials < bm.minDialsPerWeek) {
    return {
      label: "Volume issue",
      emoji: "🔴",
      hint: "Increase activity volume (dials).",
      cls: "bg-red-50",
    };
  }
  if (contactRate < bm.minContactRate) {
    return {
      label: "Contact issue",
      emoji: "🟠",
      hint: "Improve connect rate (list quality / call blocks / script).",
      cls: "bg-amber-50",
    };
  }
  if (bookingRate < bm.minBookingRate) {
    return {
      label: "Booking issue",
      emoji: "🟠",
      hint: "Improve booking rate (objections / pitch / CTA).",
      cls: "bg-amber-50",
    };
  }
  return {
    label: "Healthy",
    emoji: "🟢",
    hint: "Keep consistent — maintain momentum.",
    cls: "bg-green-50",
  };
}

/* ---------------- KPI Totals sorting ---------------- */

const KPI_ORDER: string[] = ["dials", "dials_made", "conversations", "appointments_booked"];

function kpiSort(a: [string, number], b: [string, number]) {
  const [ka] = a;
  const [kb] = b;

  const ia = KPI_ORDER.indexOf(ka);
  const ib = KPI_ORDER.indexOf(kb);

  if (ia !== -1 || ib !== -1) {
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  }
  return ka.localeCompare(kb);
}

/* ---------------- Component ---------------- */

export default function MyPerformancePage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [loadingPerf, setLoadingPerf] = useState(false);
  const [pageMsg, setPageMsg] = useState<string | null>(null);

  const [userId, setUserId] = useState<string>("");
  const [fullName, setFullName] = useState<string>("");

  const [weeks, setWeeks] = useState<WeekBlock[]>([]);
  const [benchRole, setBenchRole] = useState<"setter" | "closer">("setter");
  const [focusWeekStart, setFocusWeekStart] = useState<string>("");
  const [hideZeroKpis, setHideZeroKpis] = useState(true);

  // ✅ Daily breakdown for focused week (same as admin)
  const [days, setDays] = useState<DayBlock[]>([]);
  const [loadingDays, setLoadingDays] = useState(false);

  const perfCacheRef = useRef<Map<string, WeekBlock[]>>(new Map());
  const requestSeqRef = useRef(0);

  const currentWeekStartISO = useMemo(() => {
    const start = melbWeekStartDate(new Date());
    return toISODateMelb(start);
  }, []);

  // auth + load self profile
  useEffect(() => {
    async function init() {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;

      if (!session) {
        router.push("/login");
        return;
      }

      setUserId(session.user.id);

      const { data: profile, error: pErr } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", session.user.id)
        .single();

      if (pErr) setPageMsg(pErr.message);

      setFullName(profile?.full_name ?? "My performance");
      setLoading(false);
    }

    init();
  }, [router]);

  const loadPerformance = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!userId) return;

      const cacheKey = `${userId}:${currentWeekStartISO}`;
      const force = !!opts?.force;

      setPageMsg(null);

      if (!force) {
        const cached = perfCacheRef.current.get(cacheKey);
        if (cached) {
          setWeeks(cached);
          const newest = cached[0]?.weekStart;
          if (newest) {
            setFocusWeekStart((prev) =>
              prev && cached.some((b) => b.weekStart === prev) ? prev : newest
            );
          }
          return;
        }
      }

      setLoadingPerf(true);
      const myReq = ++requestSeqRef.current;

      try {
        // Map field_id -> key
        const { data: fieldRows, error: fErr } = await supabase
          .from("kpi_fields")
          .select("id, key");

        if (fErr) throw new Error(fErr.message);

        const keyById: Record<string, string> = {};
        (fieldRows ?? []).forEach((f: any) => (keyById[f.id] = f.key));

        const blocks: WeekBlock[] = [];

        for (let i = 0; i < 8; i++) {
          const base = new Date(currentWeekStartISO + "T00:00:00");
          base.setDate(base.getDate() - i * 7);

          const weekStart = toISODateMelb(base);
          const weekEndExclusive = addDaysISO(weekStart, 7);

          const { data: submissions, error: subErr } = await supabase
            .from("kpi_daily_submissions")
            .select("id")
            .eq("user_id", userId)
            .gte("entry_date", weekStart)
            .lt("entry_date", weekEndExclusive);

          if (subErr) throw new Error(subErr.message);

          const submissionIds = (submissions ?? []).map((s: any) => s.id);
          const totals: Record<string, number> = {};

          if (submissionIds.length > 0) {
            const { data: values, error: vErr } = await supabase
              .from("kpi_daily_values")
              .select("value_text, field_id")
              .in("submission_id", submissionIds);

            if (vErr) throw new Error(vErr.message);

            (values ?? []).forEach((v: any) => {
              const key = keyById[v.field_id];
              const num = Number(v.value_text);
              if (!isNaN(num) && key) totals[key] = (totals[key] ?? 0) + num;
            });
          }

          const { data: alerts, error: aErr } = await supabase
            .from("performance_alerts")
            .select("severity, reason, acknowledged_at, meta")
            .eq("user_id", userId)
            .eq("meta->>week_start", weekStart);

          if (aErr) throw new Error(aErr.message);

          blocks.push({
            weekStart,
            weekEndExclusive,
            totals,
            alerts: (alerts ?? []) as AlertRow[],
          });
        }

        if (requestSeqRef.current === myReq) {
          perfCacheRef.current.set(cacheKey, blocks);
          setWeeks(blocks);

          const newest = blocks[0]?.weekStart;
          if (newest) {
            setFocusWeekStart((prev) =>
              prev && blocks.some((b) => b.weekStart === prev) ? prev : newest
            );
          }
        }
      } catch (e: any) {
        if (requestSeqRef.current === myReq) {
          setPageMsg(e?.message ?? "Failed to load performance");
        }
      } finally {
        if (requestSeqRef.current === myReq) setLoadingPerf(false);
      }
    },
    [userId, currentWeekStartISO]
  );

  useEffect(() => {
    if (!userId) return;
    loadPerformance({ force: false });
  }, [userId, loadPerformance]);

  // ✅ Load daily totals for focused week (same logic as admin)
  const loadDailyForFocusedWeek = useCallback(async () => {
    if (!userId || !focusWeekStart) return;

    setLoadingDays(true);
    setPageMsg(null);

    try {
      const weekStart = focusWeekStart;
      const weekEndExclusive = addDaysISO(weekStart, 7);

      // 1) field_id -> key
      const { data: fieldRows, error: fErr } = await supabase
        .from("kpi_fields")
        .select("id, key");

      if (fErr) throw new Error(fErr.message);

      const keyById: Record<string, string> = {};
      (fieldRows ?? []).forEach((f: any) => (keyById[f.id] = f.key));

      // 2) submissions (id + entry_date)
      const { data: subs, error: sErr } = await supabase
        .from("kpi_daily_submissions")
        .select("id, entry_date")
        .eq("user_id", userId)
        .gte("entry_date", weekStart)
        .lt("entry_date", weekEndExclusive);

      if (sErr) throw new Error(sErr.message);

      const submissions = subs ?? [];
      const submissionIds = submissions.map((s: any) => s.id);

      const dateBySubmission: Record<string, string> = {};
      submissions.forEach((s: any) => (dateBySubmission[s.id] = s.entry_date));

      // 3) values
      let vals: any[] = [];
      if (submissionIds.length > 0) {
        const { data: vRows, error: vErr } = await supabase
          .from("kpi_daily_values")
          .select("submission_id, field_id, value_text")
          .in("submission_id", submissionIds);

        if (vErr) throw new Error(vErr.message);
        vals = vRows ?? [];
      }

      // 4) aggregate by date
      const totalsByDate: Record<string, Record<string, number>> = {};
      vals.forEach((v: any) => {
        const date = dateBySubmission[v.submission_id];
        const key = keyById[v.field_id];
        const num = Number(v.value_text);
        if (!date || !key || isNaN(num)) return;

        if (!totalsByDate[date]) totalsByDate[date] = {};
        totalsByDate[date][key] = (totalsByDate[date][key] ?? 0) + num;
      });

      // 5) ensure 7 days displayed
      const out: DayBlock[] = [];
      for (let i = 0; i < 7; i++) {
        const d = addDaysISO(weekStart, i);
        out.push({ date: d, totals: totalsByDate[d] ?? {} });
      }

      setDays(out);
    } catch (e: any) {
      setDays([]);
      setPageMsg(e?.message ?? "Failed to load daily totals");
    } finally {
      setLoadingDays(false);
    }
  }, [userId, focusWeekStart]);

  useEffect(() => {
    if (!userId || !focusWeekStart) return;
    loadDailyForFocusedWeek();
  }, [userId, focusWeekStart, loadDailyForFocusedWeek]);

  const chartData: ChartPoint[] = useMemo(() => {
    const chronological = [...weeks].reverse();

    return chronological.map((w) => {
      const dials = getTotalByAliases(w.totals, KPI_ALIASES.dials);
      const conversations = getTotalByAliases(w.totals, KPI_ALIASES.conversations);
      const appointments = getTotalByAliases(w.totals, KPI_ALIASES.appointments_booked);

      return {
        week: w.weekStart.slice(5),
        weekStartISO: w.weekStart,
        dials,
        conversations,
        appointments,
        contactRate: pct(conversations, dials),
        bookingRate: pct(appointments, conversations),
      };
    });
  }, [weeks]);

  const weekToPoint: Record<string, ChartPoint> = useMemo(() => {
    const map: Record<string, ChartPoint> = {};
    chartData.forEach((p) => (map[p.weekStartISO] = p));
    return map;
  }, [chartData]);

  if (loading) return <div className="p-6">Loading…</div>;

  const focusIdx = weeks.findIndex((w) => w.weekStart === focusWeekStart);
  const safeIdx = focusIdx >= 0 ? focusIdx : 0;

  const thisWeekISO = weeks[safeIdx]?.weekStart;
  const lastWeekISO = weeks[safeIdx + 1]?.weekStart;

  const thisWeek = thisWeekISO ? weekToPoint[thisWeekISO] : null;
  const lastWeek = lastWeekISO ? weekToPoint[lastWeekISO] : null;

  const dialsDelta = thisWeek && lastWeek ? metricDelta(thisWeek.dials, lastWeek.dials) : null;
  const convDelta =
    thisWeek && lastWeek ? metricDelta(thisWeek.conversations, lastWeek.conversations) : null;
  const apptDelta =
    thisWeek && lastWeek ? metricDelta(thisWeek.appointments, lastWeek.appointments) : null;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold">{fullName}</h1>
            <div className="mt-1 text-xs text-gray-500">Week anchor: {currentWeekStartISO}</div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => loadPerformance({ force: true })}
              className="rounded-xl border px-4 py-2 text-sm bg-white"
              disabled={loadingPerf}
            >
              {loadingPerf ? "Refreshing…" : "Refresh"}
            </button>

            <button
              onClick={() => router.push("/hub")}
              className="rounded-xl border px-4 py-2 text-sm bg-white"
            >
              Back
            </button>
          </div>
        </div>

        <div className="mb-6">
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="text-sm text-gray-600">Benchmarks:</span>

            <button
              onClick={() => setBenchRole("setter")}
              className={`rounded-full border px-3 py-1 text-sm ${
                benchRole === "setter" ? "bg-gray-900 text-white" : "bg-white"
              }`}
            >
              Setter
            </button>

            <button
              onClick={() => setBenchRole("closer")}
              className={`rounded-full border px-3 py-1 text-sm ${
                benchRole === "closer" ? "bg-gray-900 text-white" : "bg-white"
              }`}
            >
              Closer
            </button>

            <label className="inline-flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={hideZeroKpis}
                onChange={(e) => setHideZeroKpis(e.target.checked)}
              />
              Hide zero KPIs
            </label>

            {(loadingPerf || loadingDays) && (
              <span className="text-xs text-gray-500">Loading…</span>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="text-sm text-gray-600">Focus week:</span>
            <select
              className="rounded-xl border px-3 py-2 bg-white text-sm"
              value={focusWeekStart}
              onChange={(e) => setFocusWeekStart(e.target.value)}
            >
              {weeks.map((w) => (
                <option key={w.weekStart} value={w.weekStart}>
                  {w.weekStart}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Charts */}
        <div className="grid gap-4 md:grid-cols-3 mb-6">
          {[
            { title: "Dials (8-week)", key: "dials" as const },
            { title: "Conversations (8-week)", key: "conversations" as const },
            { title: "Appointments (8-week)", key: "appointments" as const },
          ].map((c) => (
            <div key={c.key} className="rounded-2xl border bg-white p-5">
              <h2 className="font-medium mb-3">{c.title}</h2>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="week" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey={c.key} strokeWidth={2} dot />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2 mb-6">
          {[
            { title: "Contact Rate % (Conv ÷ Dials)", key: "contactRate" as const },
            { title: "Booking Rate % (Appt ÷ Conv)", key: "bookingRate" as const },
          ].map((c) => (
            <div key={c.key} className="rounded-2xl border bg-white p-5">
              <h2 className="font-medium mb-3">{c.title}</h2>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="week" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey={c.key} strokeWidth={2} dot />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ))}
        </div>

        {/* TOP CARDS */}
        <div className="grid gap-4 md:grid-cols-4 mb-6">
          <div className="rounded-2xl border bg-white p-5">
            <div className="text-xs text-gray-500">Focused week — Dials</div>
            <div className="mt-1 text-2xl font-semibold">{thisWeek?.dials ?? 0}</div>
            {dialsDelta !== null && (
              <div
                className={`mt-2 inline-flex text-xs rounded-full border px-3 py-1 ${numBadgeClass(
                  dialsDelta
                )}`}
              >
                {labelDelta(dialsDelta)}
              </div>
            )}
          </div>

          <div className="rounded-2xl border bg-white p-5">
            <div className="text-xs text-gray-500">Focused week — Conversations</div>
            <div className="mt-1 text-2xl font-semibold">{thisWeek?.conversations ?? 0}</div>
            {convDelta !== null && (
              <div
                className={`mt-2 inline-flex text-xs rounded-full border px-3 py-1 ${numBadgeClass(
                  convDelta
                )}`}
              >
                {labelDelta(convDelta)}
              </div>
            )}
          </div>

          <div className="rounded-2xl border bg-white p-5">
            <div className="text-xs text-gray-500">Focused week — Appointments</div>
            <div className="mt-1 text-2xl font-semibold">{thisWeek?.appointments ?? 0}</div>
            {apptDelta !== null && (
              <div
                className={`mt-2 inline-flex text-xs rounded-full border px-3 py-1 ${numBadgeClass(
                  apptDelta
                )}`}
              >
                {labelDelta(apptDelta)}
              </div>
            )}
          </div>

          <div className="rounded-2xl border bg-white p-5">
            <div className="text-xs text-gray-500">Focused week — Conversion</div>
            <div className="mt-2 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Contact</span>
                <span className="font-medium">{thisWeek?.contactRate ?? 0}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Booking</span>
                <span className="font-medium">{thisWeek?.bookingRate ?? 0}%</span>
              </div>
            </div>

            {lastWeek && thisWeek && (
              <div className="mt-3 text-xs text-gray-500">
                WoW: Contact {labelDelta(deltaPct(thisWeek.contactRate, lastWeek.contactRate))} •
                Booking {labelDelta(deltaPct(thisWeek.bookingRate, lastWeek.bookingRate))}
              </div>
            )}
          </div>
        </div>

        {/* ✅ DAILY TOTALS FOR FOCUSED WEEK (added) */}
        <div className="rounded-2xl border bg-white p-5 mb-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-medium">Daily totals (focused week)</h2>
              <div className="text-xs text-gray-500 mt-1">
                Week starting {focusWeekStart} • 7-day breakdown
              </div>
            </div>

            <button
              onClick={loadDailyForFocusedWeek}
              className="rounded-xl border px-3 py-2 text-sm bg-white hover:bg-gray-50"
              disabled={loadingDays}
              title="Re-fetch daily breakdown for focused week"
            >
              {loadingDays ? "Refreshing…" : "Refresh daily"}
            </button>
          </div>

          {days.length === 0 ? (
            <div className="mt-4 text-sm text-gray-500">No daily KPI entries for this week.</div>
          ) : (
            <div className="mt-4 space-y-3">
              {days.map((d) => {
                const sortedTotals = Object.entries(d.totals)
                  .filter(([_, v]) => (hideZeroKpis ? Number(v) !== 0 : true))
                  .sort(kpiSort);

                return (
                  <div key={d.date} className="rounded-xl border p-4">
                    <div className="font-medium text-sm">{d.date}</div>

                    {sortedTotals.length === 0 ? (
                      <div className="mt-2 text-sm text-gray-500">No KPI totals.</div>
                    ) : (
                      <ul className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                        {sortedTotals.map(([k, v]) => (
                          <li key={k} className="rounded-lg border px-3 py-2 flex justify-between">
                            <span className="capitalize">{k.replaceAll("_", " ")}</span>
                            <span className="font-medium">{v}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Weeks list */}
        <div className="space-y-4">
          {weeks.map((w, idx) => {
            const thisPoint = weekToPoint[w.weekStart];
            const prev = weeks[idx + 1];
            const prevPoint = prev ? weekToPoint[prev.weekStart] : null;

            const contactDelta =
              prevPoint && thisPoint ? deltaPct(thisPoint.contactRate, prevPoint.contactRate) : 0;

            const bookingDelta =
              prevPoint && thisPoint ? deltaPct(thisPoint.bookingRate, prevPoint.bookingRate) : 0;

            const bm = BENCHMARKS[benchRole];
            const diagnosis = thisPoint
              ? diagnoseWeek(w.totals, thisPoint.contactRate, thisPoint.bookingRate, bm)
              : null;

            const sortedTotals = Object.entries(w.totals)
              .filter(([_, v]) => (hideZeroKpis ? Number(v) !== 0 : true))
              .sort(kpiSort);

            return (
              <div key={w.weekStart} className="rounded-2xl border bg-white p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-medium">Week starting {w.weekStart}</h2>
                    <div className="text-xs text-gray-500 mt-1">
                      End (exclusive): {w.weekEndExclusive}
                    </div>
                  </div>
                </div>

                {thisPoint && (
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl border p-3 flex items-center justify-between">
                      <div>
                        <div className="text-gray-500 text-xs">Contact Rate</div>
                        <div className="font-medium">{thisPoint.contactRate}%</div>
                      </div>
                      {prevPoint && (
                        <div
                          className={`text-xs rounded-full border px-3 py-1 ${badgeClass(
                            contactDelta
                          )}`}
                        >
                          {labelDelta(contactDelta)}
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border p-3 flex items-center justify-between">
                      <div>
                        <div className="text-gray-500 text-xs">Booking Rate</div>
                        <div className="font-medium">{thisPoint.bookingRate}%</div>
                      </div>
                      {prevPoint && (
                        <div
                          className={`text-xs rounded-full border px-3 py-1 ${badgeClass(
                            bookingDelta
                          )}`}
                        >
                          {labelDelta(bookingDelta)}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {diagnosis && (
                  <div className={`mt-3 rounded-xl border p-3 text-sm ${diagnosis.cls}`}>
                    <div className="font-medium">
                      {diagnosis.emoji} {diagnosis.label}
                    </div>
                    <div className="text-xs text-gray-600 mt-1">{diagnosis.hint}</div>
                  </div>
                )}

                {sortedTotals.length === 0 ? (
                  <div className="mt-3 text-sm text-gray-500">No KPI totals (after filters).</div>
                ) : (
                  <ul className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    {sortedTotals.map(([k, v]) => (
                      <li key={k} className="rounded-lg border px-3 py-2 flex justify-between">
                        <span className="capitalize">{k.replaceAll("_", " ")}</span>
                        <span className="font-medium">{v}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {w.alerts?.length ? (
                  <div className="mt-4 space-y-2">
                    {w.alerts.map((a, i) => (
                      <div
                        key={i}
                        className={`rounded-xl border p-3 text-sm ${
                          a.severity === "red"
                            ? "bg-red-50"
                            : a.severity === "amber"
                            ? "bg-amber-50"
                            : "bg-green-50"
                        }`}
                      >
                        <span className="font-medium mr-2">
                          {a.severity === "red" ? "🔴" : a.severity === "amber" ? "🟠" : "🟢"}
                        </span>
                        {a.reason}
                        <div className="mt-1 text-xs text-gray-500">
                          {a.acknowledged_at ? "Acknowledged" : "Not acknowledged"}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 text-sm text-green-600">🟢 No alerts this week</div>
                )}
              </div>
            );
          })}
        </div>

        {pageMsg && (
          <div className="mt-6 rounded-xl border bg-gray-50 p-3 text-sm text-gray-700">
            {pageMsg}
          </div>
        )}
      </div>
    </div>
  );
}