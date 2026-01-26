"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

/* ---------------- Types ---------------- */

type DailyRow = {
  entry_date: string; // YYYY-MM-DD
  values: Record<string, number>;
};

type Flag = { level: "green" | "amber" | "red"; text: string };

/* ---------------- Date helpers ---------------- */

function melbourneWeekStart(d: Date): Date {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
}

function toISODateMelb(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d);
}

/* ---------------- Inner page (uses search params) ---------------- */

function KpiWeeklyInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const roleView: "setter" | "closer" =
    searchParams.get("role") === "closer" ? "closer" : "setter";

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<DailyRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [flags, setFlags] = useState<Flag[]>([]);

  const weekStart = useMemo(() => melbourneWeekStart(new Date()), []);
  const weekStartISO = useMemo(() => toISODateMelb(weekStart), [weekStart]);

  /* ---------------- Load ---------------- */

  useEffect(() => {
    async function load() {
      setLoading(true);
      setMessage(null);

      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;

      if (!session) {
        router.push("/login");
        return;
      }

      try {
        // =========================
        // SETTER → DAILY KPIs
        // =========================
        if (roleView === "setter") {
          const { data: submissions, error: subErr } = await supabase
            .from("kpi_daily_submissions")
            .select("id, entry_date")
            .gte("entry_date", weekStartISO)
            .eq("user_id", session.user.id)
            .order("entry_date", { ascending: true });

          if (subErr) throw new Error(subErr.message);

          if (!submissions || submissions.length === 0) {
            setRows([]);
            setFlags([{ level: "green", text: "No KPI submissions yet this week." }]);
            setLoading(false);
            return;
          }

          const submissionIds = submissions.map((s) => s.id);

          const { data: values, error: valErr } = await supabase
            .from("kpi_daily_values")
            .select(
              `
              submission_id,
              value_text,
              field:kpi_fields ( key )
            `
            )
            .in("submission_id", submissionIds);

          if (valErr) throw new Error(valErr.message);

          const bySubmission: Record<string, DailyRow> = {};
          submissions.forEach((s) => {
            bySubmission[s.id] = { entry_date: s.entry_date, values: {} };
          });

          (values ?? []).forEach((v: any) => {
            const key = v.field?.key;
            const num = Number(v.value_text);
            if (!Number.isNaN(num) && key && bySubmission[v.submission_id]) {
              bySubmission[v.submission_id].values[key] = num;
            }
          });

          setRows(Object.values(bySubmission));
          setFlags([{ level: "green", text: "Daily KPIs loaded successfully." }]);
          setLoading(false);
          return;
        }

        // =========================
        // CLOSER → MEETINGS
        // =========================
        const { data: meetings, error: meetErr } = await supabase
          .from("meetings")
          .select(
            "meeting_at, showed_up, moved_to_ss2, is_closed, attended_by_id, booked_by_id, booked_calendar_user_id"
          )
          .gte("meeting_at", `${weekStartISO}T00:00:00`)
          .or(
            `attended_by_id.eq.${session.user.id},booked_by_id.eq.${session.user.id},booked_calendar_user_id.eq.${session.user.id}`
          );

        if (meetErr) throw new Error(meetErr.message);

        if (!meetings || meetings.length === 0) {
          setRows([]);
          setFlags([{ level: "green", text: "No meetings attended yet this week." }]);
          setLoading(false);
          return;
        }

        const byDate: Record<string, DailyRow> = {};

        for (const m of meetings) {
          const date = toISODateMelb(new Date(m.meeting_at));
          if (!byDate[date]) byDate[date] = { entry_date: date, values: {} };

          byDate[date].values["meetings_attended"] =
            (byDate[date].values["meetings_attended"] ?? 0) + 1;

          if (m.showed_up) {
            byDate[date].values["shows"] = (byDate[date].values["shows"] ?? 0) + 1;
          }

          if (m.moved_to_ss2) {
            byDate[date].values["moved_to_ss2"] =
              (byDate[date].values["moved_to_ss2"] ?? 0) + 1;
          }

          if (m.is_closed) {
            byDate[date].values["closed"] = (byDate[date].values["closed"] ?? 0) + 1;
          }
        }

        setRows(Object.values(byDate));
        setFlags([{ level: "green", text: "Meeting outcomes loaded successfully." }]);
        setLoading(false);
      } catch (e: any) {
        setMessage(e?.message ?? "Failed to load weekly KPIs.");
        setLoading(false);
      }
    }

    load();
  }, [router, weekStartISO, roleView]);

  if (loading) return <div className="p-6">Loading…</div>;

  const chartData = rows.map((r) => ({
    date: r.entry_date.slice(5),
    dials: r.values["dials"] ?? 0,
  }));

  const weeklyTotals = rows.reduce((acc: Record<string, number>, r) => {
    for (const [k, v] of Object.entries(r.values)) {
      acc[k] = (acc[k] ?? 0) + v;
    }
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Weekly KPI ({roleView})</h1>
          <button
            onClick={() => router.push("/hub")}
            className="rounded-xl border px-4 py-2 text-sm bg-white"
          >
            Back
          </button>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-xl border bg-white p-4 text-sm">
            No activity recorded yet this week.
          </div>
        ) : (
          <div className="space-y-6">
            {/* Flags */}
            <div className="rounded-2xl border bg-white p-5">
              <h2 className="font-medium mb-2">Performance Flags</h2>
              <div className="space-y-2">
                {flags.map((f, i) => (
                  <div
                    key={i}
                    className={`rounded-xl border p-3 text-sm ${
                      f.level === "red"
                        ? "bg-red-50"
                        : f.level === "amber"
                        ? "bg-amber-50"
                        : "bg-green-50"
                    }`}
                  >
                    {f.text}
                  </div>
                ))}
              </div>
            </div>

            {/* Chart */}
            {roleView === "setter" && (
              <div className="rounded-2xl border bg-white p-6">
                <h2 className="font-medium mb-4">Dials — Daily Trend</h2>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip />
                      <Line type="monotone" dataKey="dials" strokeWidth={2} dot />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Totals */}
            <div className="rounded-2xl border bg-white p-6">
              <h2 className="font-medium mb-3">Weekly Totals</h2>
              <ul className="grid grid-cols-2 gap-3 text-sm">
                {Object.entries(weeklyTotals).map(([k, v]) => (
                  <li key={k} className="rounded-lg border px-3 py-2 flex justify-between">
                    <span className="capitalize">{k.replaceAll("_", " ")}</span>
                    <span className="font-medium">{v}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {message && (
          <div className="mt-4 rounded-xl border bg-gray-50 p-3 text-sm">
            {message}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Wrapper (adds suspense boundary) ---------------- */

export default function KpiWeeklyPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading…</div>}>
      <KpiWeeklyInner />
    </Suspense>
  );
}