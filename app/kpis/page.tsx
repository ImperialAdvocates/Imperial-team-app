"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type WindowLabel = "7d" | "30d" | "90d" | "all";
type Mode = "setter" | "closer";

/* ---------------- Helpers ---------------- */

function pct(v: number | null | undefined) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(0)}%`;
}

function n(v: number | null | undefined) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return String(v);
}

function normRole(r?: string | null) {
  return (r ?? "").trim().toLowerCase();
}

/* ---------------- Row Types (from views) ---------------- */

type BaseKpiRow = {
  window_label: string; // "7d" | "30d" | "90d" | "all"
  window_days: number | null;
  user_id: string;
  full_name: string | null;
  role?: string | null;
};

type SetterKpiRow = BaseKpiRow & {
  meetings_booked: number;
  showed_up_count: number;
  show_rate: number; // 0..1
  moved_to_ss2_count: number;
  ss2_rate: number; // 0..1
  closed_count: number;
  close_rate: number; // 0..1
};

type CloserKpiRow = BaseKpiRow & {
  meetings_attended: number;
  moved_to_ss2_count: number;
  ss2_rate: number; // 0..1
  closed_count: number;
  close_rate: number; // 0..1
};

export default function KpisPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>("setter");
  const [windowLabel, setWindowLabel] = useState<WindowLabel>("7d");

  // single dataset; cast based on mode when rendering
  const [rows, setRows] = useState<Array<SetterKpiRow | CloserKpiRow>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);

    // auth
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session) {
      router.push("/login");
      return;
    }

    const uid = session.user.id;

    // Confirm admin (optional, but recommended)
    const { data: myProfile, error: myErr } = await supabase
      .from("profiles")
      .select("id, role")
      .eq("id", uid)
      .single();

    if (myErr) {
      setMsg(myErr.message);
      setLoading(false);
      return;
    }
    if (normRole(myProfile?.role) !== "admin") {
      router.push("/hub");
      return;
    }

    const viewName = mode === "setter" ? "v_setter_kpis_named" : "v_closer_kpis_named";

    const { data, error } = await supabase.from(viewName).select("*");

    if (error) {
      setMsg(error.message);
      setRows([]);
      setLoading(false);
      return;
    }

    setRows((data ?? []) as any);
    setLoading(false);
  }, [router, mode]); // ✅ mode included, so it reloads when you toggle

  useEffect(() => {
    load();
  }, [load]);

  const activeRows = useMemo(() => {
    const wl = windowLabel;

    const filtered = rows.filter((r) => (r.window_label ?? "").toLowerCase() === wl);

    if (mode === "setter") {
      return (filtered as SetterKpiRow[]).sort((a, b) => {
        const cr = (b.close_rate ?? 0) - (a.close_rate ?? 0);
        if (cr !== 0) return cr;
        const sr = (b.ss2_rate ?? 0) - (a.ss2_rate ?? 0);
        if (sr !== 0) return sr;
        return (b.meetings_booked ?? 0) - (a.meetings_booked ?? 0);
      });
    }

    return (filtered as CloserKpiRow[]).sort((a, b) => {
      const cr = (b.close_rate ?? 0) - (a.close_rate ?? 0);
      if (cr !== 0) return cr;
      const sr = (b.ss2_rate ?? 0) - (a.ss2_rate ?? 0);
      if (sr !== 0) return sr;
      return (b.meetings_attended ?? 0) - (a.meetings_attended ?? 0);
    });
  }, [mode, windowLabel, rows]);

  if (loading) return <div className="p-6 text-black">Loading…</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-6 text-black">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold">KPIs</h1>
            <div className="mt-1 text-xs text-black/70">
              Leaderboard • Toggle Setter / Closer • Window = 7d / 30d / 90d / all
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={load} className="rounded-xl border px-4 py-2 text-sm bg-white">
              Refresh
            </button>
            <button onClick={() => router.push("/hub")} className="rounded-xl border px-4 py-2 text-sm bg-white">
              Back
            </button>
          </div>
        </div>

        {/* Controls */}
        <div className="mb-4 rounded-2xl border bg-white p-4">
          <div className="flex flex-col md:flex-row md:items-end gap-3">
            <div className="flex-1">
              <label className="text-xs font-medium">Mode</label>
              <div className="mt-1 flex gap-2">
                <button
                  onClick={() => setMode("setter")}
                  className={`rounded-xl px-4 py-2 text-sm border ${
                    mode === "setter" ? "bg-black text-white" : "bg-white text-black"
                  }`}
                >
                  Setter
                </button>
                <button
                  onClick={() => setMode("closer")}
                  className={`rounded-xl px-4 py-2 text-sm border ${
                    mode === "closer" ? "bg-black text-white" : "bg-white text-black"
                  }`}
                >
                  Closer
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium">Window</label>
              <select
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                value={windowLabel}
                onChange={(e) => setWindowLabel(e.target.value as WindowLabel)}
              >
                <option value="7d">7d</option>
                <option value="30d">30d</option>
                <option value="90d">90d</option>
                <option value="all">all</option>
              </select>
            </div>
          </div>

          <div className="mt-3 text-xs text-black/70">
            Sorting: highest close rate first → then SS2 rate → then volume.
          </div>
        </div>

        {/* Table */}
        <div className="rounded-2xl border bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">
              {mode === "setter" ? "Setter leaderboard" : "Closer leaderboard"} • {windowLabel}
            </h2>
            <div className="text-xs text-black/50">{activeRows.length} people</div>
          </div>

          {activeRows.length === 0 ? (
            <div className="mt-4 text-sm text-black/70">No KPI rows found for this window.</div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              {mode === "setter" ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-black/60">
                      <th className="py-2">Person</th>
                      <th className="py-2">Booked</th>
                      <th className="py-2">Showed</th>
                      <th className="py-2">Show %</th>
                      <th className="py-2">SS2</th>
                      <th className="py-2">SS2 %</th>
                      <th className="py-2">Closed</th>
                      <th className="py-2">Close %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(activeRows as SetterKpiRow[]).map((r) => (
                      <tr key={r.user_id} className="border-t">
                        <td className="py-2 font-medium">{r.full_name ?? r.user_id}</td>
                        <td className="py-2">{n(r.meetings_booked)}</td>
                        <td className="py-2">{n(r.showed_up_count)}</td>
                        <td className="py-2">{pct(r.show_rate)}</td>
                        <td className="py-2">{n(r.moved_to_ss2_count)}</td>
                        <td className="py-2">{pct(r.ss2_rate)}</td>
                        <td className="py-2">{n(r.closed_count)}</td>
                        <td className="py-2">{pct(r.close_rate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-black/60">
                      <th className="py-2">Person</th>
                      <th className="py-2">Attended</th>
                      <th className="py-2">SS2</th>
                      <th className="py-2">SS2 %</th>
                      <th className="py-2">Closed</th>
                      <th className="py-2">Close %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(activeRows as CloserKpiRow[]).map((r) => (
                      <tr key={r.user_id} className="border-t">
                        <td className="py-2 font-medium">{r.full_name ?? r.user_id}</td>
                        <td className="py-2">{n(r.meetings_attended)}</td>
                        <td className="py-2">{n(r.moved_to_ss2_count)}</td>
                        <td className="py-2">{pct(r.ss2_rate)}</td>
                        <td className="py-2">{n(r.closed_count)}</td>
                        <td className="py-2">{pct(r.close_rate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

        {msg && <div className="mt-6 rounded-xl border bg-gray-50 p-3 text-sm">{msg}</div>}
      </div>
    </div>
  );
}