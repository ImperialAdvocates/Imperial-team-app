"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const TEAM_ROLE = "setter"; // your "team bucket" for targets

type TargetRow = {
  id: string;
  role: string;
  kpi_key: string;
  target_weekly: number;
  active: boolean;
  created_at?: string;
  // UI-only
  target_monthly?: number;
};

type ProfileRow = { id: string; role: string | null; is_admin: boolean | null };

function normRole(r?: string | null) {
  return (r ?? "").trim().toLowerCase();
}

function isAdminOk(role?: string | null, is_admin?: boolean | null) {
  return !!is_admin || normRole(role) === "admin";
}

/* ---------------- Business Month Helpers (26th -> 25th) ---------------- */

function businessMonthStart(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);

  if (x.getDate() >= 26) {
    x.setDate(26);
  } else {
    x.setMonth(x.getMonth() - 1);
    x.setDate(26);
  }
  return x;
}

function businessMonthEndExclusive(start: Date) {
  const x = new Date(start);
  x.setMonth(x.getMonth() + 1);
  x.setDate(26);
  x.setHours(0, 0, 0, 0);
  return x;
}

function weeksInBusinessMonth(now: Date) {
  const start = businessMonthStart(now);
  const end = businessMonthEndExclusive(start);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
  return days / 7;
}

function weeklyFromMonthlyCount(monthly: number, now = new Date()) {
  const w = weeksInBusinessMonth(now);
  if (!Number.isFinite(monthly) || monthly <= 0) return 0;
  return Math.ceil(monthly / w);
}

function monthlyFromWeeklyCount(weekly: number, now = new Date()) {
  const w = weeksInBusinessMonth(now);
  if (!Number.isFinite(weekly) || weekly <= 0) return 0;
  return Math.round(weekly * w);
}

function clampPct(x: number) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, x));
}

function safeNum(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Our simple KPI set for the new system.
 * - appointments_booked: count (monthly input)
 * - show_rate: percent (monthly input; stored same as weekly)
 * - ss2_rate: percent (monthly input; stored same as weekly)
 * - shows: derived count (monthly) = booked * show_rate
 * - moved_to_ss2: derived count (monthly) = shows * ss2_rate
 */
const KPI_ORDER = ["appointments_booked", "show_rate", "ss2_rate", "shows", "moved_to_ss2"] as const;
type KpiKey = (typeof KPI_ORDER)[number];

const LABELS: Record<KpiKey, string> = {
  appointments_booked: "Appointments booked",
  show_rate: "Show rate (%)",
  ss2_rate: "SS2 rate (%)",
  shows: "Shows (derived)",
  moved_to_ss2: "Moved to SS2 (derived)",
};

const IS_PERCENT = new Set<KpiKey>(["show_rate", "ss2_rate"]);
const IS_DERIVED = new Set<KpiKey>(["shows", "moved_to_ss2"]);

export default function AdminKpiSetupPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const monthWeeks = useMemo(() => weeksInBusinessMonth(new Date()), []);

  const [targets, setTargets] = useState<TargetRow[]>([]);

  const targetsByKey = useMemo(() => {
    const m: Record<string, TargetRow> = {};
    targets.forEach((t) => (m[t.kpi_key] = t));
    return m;
  }, [targets]);

  function patchByKey(kpi_key: KpiKey, patch: Partial<TargetRow>) {
    setTargets((prev) =>
      prev.map((t) => (t.kpi_key === kpi_key ? { ...t, ...patch } : t))
    );
  }

  const requireAdmin = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session) {
      router.push("/login");
      return false;
    }

    const meRes = await supabase
      .from("profiles")
      .select("id, role, is_admin")
      .eq("id", session.user.id)
      .single();

    if (meRes.error) {
      setMsg(meRes.error.message);
      return false;
    }

    if (!isAdminOk(meRes.data?.role, meRes.data?.is_admin)) {
      router.push("/hub");
      return false;
    }

    return true;
  }, [router]);

  const loadTargets = useCallback(async () => {
    const res = await supabase
      .from("kpi_targets")
      .select("id, role, kpi_key, target_weekly, active, created_at")
      .eq("role", TEAM_ROLE);

    if (res.error) throw new Error(res.error.message);

    const existing = (res.data ?? []) as TargetRow[];

    // Ensure all keys exist (create UI rows even if missing in DB yet)
    const map: Record<string, TargetRow> = {};
    existing.forEach((r) => (map[r.kpi_key] = r));

    const ensured: TargetRow[] = KPI_ORDER.map((k) => {
      const row = map[k];
      if (row) return { ...row };

      // placeholder row (not saved yet)
      return {
        id: `temp_${k}`,
        role: TEAM_ROLE,
        kpi_key: k,
        target_weekly: 0,
        active: true,
      };
    });

    // derive monthly for UI
    const withMonthly = ensured.map((t) => {
      const wk = safeNum(t.target_weekly);
      const monthly = IS_PERCENT.has(t.kpi_key as KpiKey)
        ? wk
        : monthlyFromWeeklyCount(wk);

      return { ...t, target_monthly: monthly };
    });

    setTargets(withMonthly);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const ok = await requireAdmin();
      if (!ok) {
        setLoading(false);
        return;
      }
      await loadTargets();
      setLoading(false);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to load KPI targets.");
      setLoading(false);
    }
  }, [requireAdmin, loadTargets]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const recomputeDerivedMonthly = useCallback(() => {
    const booked = safeNum(targetsByKey["appointments_booked"]?.target_monthly);
    const showRate = clampPct(safeNum(targetsByKey["show_rate"]?.target_monthly));
    const ss2Rate = clampPct(safeNum(targetsByKey["ss2_rate"]?.target_monthly));

    const shows = Math.round(booked * (showRate / 100));
    const moved = Math.round(shows * (ss2Rate / 100));

    patchByKey("shows", { target_monthly: shows });
    patchByKey("moved_to_ss2", { target_monthly: moved });
  }, [targetsByKey]);

  // whenever inputs change, keep derived values correct in UI
  useEffect(() => {
    if (targets.length === 0) return;
    recomputeDerivedMonthly();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    targetsByKey["appointments_booked"]?.target_monthly,
    targetsByKey["show_rate"]?.target_monthly,
    targetsByKey["ss2_rate"]?.target_monthly,
  ]);

  async function saveTargets() {
    setSaving(true);
    setMsg(null);

    try {
      // Ensure derived are up to date before saving
      recomputeDerivedMonthly();

      // Build payload for DB (store weekly)
      const payload = KPI_ORDER.map((k) => {
        const row = targetsByKey[k];
        const monthly = safeNum(row?.target_monthly);

        const weekly = IS_PERCENT.has(k)
          ? clampPct(monthly) // percent just stored as-is
          : weeklyFromMonthlyCount(monthly);

        return {
          // if temp row, omit id so DB generates a new one
          ...(row?.id?.startsWith("temp_") ? {} : { id: row?.id }),
          role: TEAM_ROLE,
          kpi_key: k,
          target_weekly: weekly,
          active: row?.active ?? true,
        };
      });

      const { error } = await supabase
        .from("kpi_targets")
        .upsert(payload, { onConflict: "role,kpi_key" });

      if (error) throw new Error(error.message);

      await loadTargets();

      setMsg("Saved ✅");
      setTimeout(() => setMsg(null), 1200);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to save targets.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-6 text-black">Loading…</div>;

  return (
    <div className="min-h-[100dvh] bg-gray-50 p-4 text-black">
      <div className="mx-auto w-full max-w-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="text-xs text-black/60">Admin</div>
            <h1 className="text-2xl font-semibold">KPI Targets</h1>
            <div className="mt-1 text-xs text-black/60">
              Set <b>monthly</b> targets for the team. We store weekly in <code>kpi_targets</code>.
            </div>
            <div className="mt-1 text-[11px] text-black/50">
              Weeks in current business month: <b>{monthWeeks.toFixed(2)}</b> • role=<code>{TEAM_ROLE}</code>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => router.push("/admin")}
              className="rounded-xl border bg-white px-3 py-2 text-xs"
            >
              Back
            </button>
            <button
              onClick={loadAll}
              disabled={saving}
              className="rounded-xl border bg-white px-3 py-2 text-xs"
            >
              Refresh
            </button>
            <button
              onClick={saveTargets}
              disabled={saving}
              className="rounded-xl bg-black px-3 py-2 text-xs text-white disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {/* Targets */}
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-sm font-semibold mb-2">Team targets (monthly)</div>
          <div className="text-xs text-black/60 mb-4">
            <b>Shows</b> and <b>Moved to SS2</b> are auto-calculated.
          </div>

          <div className="space-y-3">
            {KPI_ORDER.map((k) => {
              const row = targetsByKey[k];
              const monthly = safeNum(row?.target_monthly);
              const active = row?.active ?? true;

              const weeklyDisplay = IS_PERCENT.has(k)
                ? clampPct(monthly)
                : weeklyFromMonthlyCount(monthly);

              return (
                <div key={k} className="rounded-xl border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{LABELS[k]}</div>
                      <div className="text-xs text-black/50">
                        key: <code>{k}</code>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => patchByKey(k, { active: !active })}
                      className={`rounded-xl border px-3 py-2 text-xs ${
                        active ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
                      }`}
                      disabled={saving}
                    >
                      {active ? "Active" : "Inactive"}
                    </button>
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <label className="text-xs text-black/60">
                      Monthly target
                      <input
                        className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                        type="number"
                        value={IS_PERCENT.has(k) ? clampPct(monthly) : monthly}
                        disabled={IS_DERIVED.has(k)}
                        onChange={(e) => {
                          const v = safeNum(e.target.value);
                          patchByKey(k, {
                            target_monthly: IS_PERCENT.has(k) ? clampPct(v) : v,
                          });
                        }}
                      />
                      {IS_DERIVED.has(k) ? (
                        <div className="mt-1 text-[11px] text-black/50">
                          Auto-calculated
                        </div>
                      ) : null}
                    </label>

                    <div className="text-xs text-black/60">
                      Weekly stored (auto)
                      <div className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-gray-50">
                        {weeklyDisplay}
                      </div>
                      <div className="mt-1 text-[11px] text-black/50">
                        Saved to <code>kpi_targets.target_weekly</code>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 text-[11px] text-black/50 leading-relaxed">
            Logic:
            <br />• <b>Shows</b> = Appointments booked × Show rate
            <br />• <b>Moved to SS2</b> = Shows × SS2 rate
            <br />• Percent KPIs store the same number weekly & monthly.
          </div>
        </div>

        {msg && (
          <div className="mt-4 rounded-xl border bg-gray-50 p-3 text-sm text-black">
            {msg}
          </div>
        )}
      </div>
    </div>
  );
}