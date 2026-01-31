"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import FocusTimer from "@/src/app/login/components/FocusTimer";

type AlertCardTone = "red" | "amber" | "green" | "blue";
type LeaderboardMode = "weekly" | "monthly";

const LEADERBOARD_LIMIT = 10;

/* ---------------- UI helpers ---------------- */

function toneClasses(tone: AlertCardTone) {
  switch (tone) {
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

function toISODateMelb(d: Date): string {
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

function safeNum(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function pctOrDash(numer: number, denom: number): { pctText: string; numer: number; denom: number } {
  if (!denom) return { pctText: "—", numer, denom };
  return { pctText: `${Math.round((numer / denom) * 100)}%`, numer, denom };
}

/** Monday-start week in Melbourne time, returned as YYYY-MM-DD */
function startOfWeekISO_Melb(today: Date) {
  const local = new Date(today);
  const day = local.getDay();
  const diffToMon = (day + 6) % 7;
  local.setDate(local.getDate() - diffToMon);
  local.setHours(0, 0, 0, 0);
  return toISODateMelb(local);
}

/**
 * Business month:
 * - starts on the 26th
 * - ends (exclusive) on the 26th of next month
 */
function businessMonthRangeISO(now: Date) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

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

function AlertCard({
  title,
  description,
  tone,
  ctaLabel,
  onClick,
}: {
  title: string;
  description: string;
  tone: AlertCardTone;
  ctaLabel?: string;
  onClick?: () => void;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${toneClasses(tone)}`}>
      <div className="text-sm font-semibold leading-snug">{title}</div>
      <div className="mt-2 text-xs leading-relaxed opacity-80 whitespace-pre-line">{description}</div>

      {ctaLabel && onClick ? (
        <button onClick={onClick} className="mt-4 w-full rounded-xl bg-black px-3 py-2 text-xs text-white">
          {ctaLabel}
        </button>
      ) : null}
    </div>
  );
}

/* ---------------- Types ---------------- */

type LeaderRow = {
  user_id: string;
  name: string;

  booked_kpi: number;

  // BOOKER-owned (show rate)
  booked_occurred: number;
  booked_showed: number;
  show_rate_text: string;

  // TAKER-owned (move rate)
  taken_total: number;
  taken_showed: number;
  taken_moved: number;
  move_rate_text: string;
};

type WeeklyTargets = {
  booked: number | null;     // appointments_booked weekly target
  show_rate: number | null;  // optional %
  move_rate: number | null;  // optional %
};

const ROUTES = {
  meetings: "/meetings",
  dailyKpis: "/daily-kpis",
  docsAll: "/documents",
  profile: "/profile",
} as const;

/* ---------------- Dropdown ---------------- */

function useDropdownClose() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-dd-root]")) setOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  return { open, setOpen };
}

function QuickActionsDropdown({
  router,
  isAdmin,
}: {
  router: ReturnType<typeof useRouter>;
  isAdmin: boolean;
}) {
  const { open, setOpen } = useDropdownClose();

  const go = (path: string) => {
    setOpen(false);
    router.push(path);
  };

  return (
    <div className="relative" data-dd-root>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="rounded-xl border bg-white px-4 py-2 text-sm text-black"
      >
        Quick Actions ▾
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 rounded-2xl border bg-white shadow-sm overflow-hidden z-50">
          <div className="px-3 py-2 text-xs font-semibold text-black/60">Core</div>

          <button onClick={() => go(ROUTES.meetings)} className="w-full px-3 py-3 text-left text-sm hover:bg-gray-50">
            📅 Meetings
            <div className="text-xs text-black/50 mt-1">View + update outcomes</div>
          </button>

          <button onClick={() => go(ROUTES.dailyKpis)} className="w-full px-3 py-3 text-left text-sm hover:bg-gray-50">
            📌 Daily KPI Entry
            <div className="text-xs text-black/50 mt-1">Appointments booked</div>
          </button>

          <button onClick={() => go(ROUTES.docsAll)} className="w-full px-3 py-3 text-left text-sm hover:bg-gray-50">
            📄 Documents
            <div className="text-xs text-black/50 mt-1">Company docs + resources</div>
          </button>

          <button onClick={() => go(ROUTES.profile)} className="w-full px-3 py-3 text-left text-sm hover:bg-gray-50">
            👤 Profile
            <div className="text-xs text-black/50 mt-1">Logout or delete account</div>
          </button>

          {isAdmin ? (
            <>
              <div className="px-3 py-2 text-xs font-semibold text-black/60">Admin</div>
              <button onClick={() => go("/admin")} className="w-full px-3 py-3 text-left text-sm hover:bg-gray-50">
                🛠 Admin Hub
              </button>
              <button onClick={() => go("/admin/kpi-templates")} className="w-full px-3 py-3 text-left text-sm hover:bg-gray-50">
                🎯 KPI Setup
              </button>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ---------------- Page ---------------- */

export default function HubPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [myRole, setMyRole] = useState<string>("");
  const [isAdmin, setIsAdmin] = useState(false);

  const [todaySubmitted, setTodaySubmitted] = useState<boolean>(false);

  const [teamLeaders, setTeamLeaders] = useState<LeaderRow[]>([]);
  const [leaderboardMode, setLeaderboardMode] = useState<LeaderboardMode>("weekly");

  // ✅ weekly target banner data
  const [weeklyTargets, setWeeklyTargets] = useState<WeeklyTargets | null>(null);

  const todayISO = useMemo(() => toISODateMelb(new Date()), []);

  const { monthStartISO, monthEndExclusiveISO } = useMemo(() => businessMonthRangeISO(new Date()), []);
  const weekStartISO = useMemo(() => startOfWeekISO_Melb(new Date()), []);
  const weekEndExclusiveISO = useMemo(() => addDaysISO(weekStartISO, 7), [weekStartISO]);

  const rangeStartISO = leaderboardMode === "monthly" ? monthStartISO : weekStartISO;
  const rangeEndExclusiveISO = leaderboardMode === "monthly" ? monthEndExclusiveISO : weekEndExclusiveISO;

  const rangeStartUtcIso = useMemo(() => melbMidnightToUtcIso(rangeStartISO), [rangeStartISO]);
  const rangeEndUtcIso = useMemo(() => melbMidnightToUtcIso(rangeEndExclusiveISO), [rangeEndExclusiveISO]);

  const loadWeeklyTargetsSafe = useCallback(async () => {
    const res = await supabase
      .from("kpi_targets")
      .select("kpi_key, target_weekly, active, role")
      .eq("active", true)
      .eq("role", "setter");

    if (res.error) {
      // If table doesn't exist (or RLS), just show "Not set"
      setWeeklyTargets(null);
      return;
    }

    const next: WeeklyTargets = { booked: null, show_rate: null, move_rate: null };
    const rows = (res.data ?? []) as any[];

    for (const r of rows) {
      const key = String(r.kpi_key ?? "").trim();
      const val = Number(r.target_weekly ?? 0);
      if (!Number.isFinite(val)) continue;

      if (key === "appointments_booked") next.booked = val;
      if (key === "show_rate") next.show_rate = val;
      if (key === "ss2_rate") next.move_rate = val;
    }

    setWeeklyTargets(next);
  }, []);

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
      // My profile
      const myProfileRes = await supabase
        .from("profiles")
        .select("id, role, is_admin")
        .eq("id", uid)
        .single();

      if (myProfileRes.error) throw new Error(myProfileRes.error.message);

      const r = normRole(myProfileRes.data?.role);
      setMyRole(r);
      const adminFlag = !!(myProfileRes.data as any)?.is_admin || r === "admin";
      setIsAdmin(adminFlag);

      // ✅ load weekly targets (safe fallback)
      await loadWeeklyTargetsSafe();

      // Today KPI submitted?
      const todayKpiRes = await supabase
        .from("daily_kpis")
        .select("id")
        .eq("user_id", uid)
        .eq("entry_date", todayISO)
        .maybeSingle();

      if (todayKpiRes.error) throw new Error(todayKpiRes.error.message);
      setTodaySubmitted(!!todayKpiRes.data);

      // Staff list
      const profRes = await supabase
        .from("profiles")
        .select("id, full_name")
        .order("full_name", { ascending: true });

      if (profRes.error) throw new Error(profRes.error.message);

      const staff = (profRes.data ?? []) as { id: string; full_name: string | null }[];
      const userIds = staff.map((p) => p.id).filter(Boolean);

      // 1) Booked KPI (daily_kpis)
      const bookedKpiByUser: Record<string, number> = {};
      if (userIds.length > 0) {
        const dkRes = await supabase
          .from("daily_kpis")
          .select("user_id, appointments_booked, entry_date")
          .in("user_id", userIds)
          .gte("entry_date", rangeStartISO)
          .lt("entry_date", rangeEndExclusiveISO);

        if (dkRes.error) throw new Error(dkRes.error.message);

        (dkRes.data ?? []).forEach((row: any) => {
          const u = row.user_id;
          if (!u) return;
          bookedKpiByUser[u] = (bookedKpiByUser[u] ?? 0) + safeNum(row.appointments_booked);
        });
      }

      // 2) Meetings metrics (simplified schema)
      const mtgRes = await supabase
        .from("meetings")
        .select("meeting_at, booked_by_id, attended_by_id, showed_up, moved_to_ss2, discarded_at")
        .is("discarded_at", null)
        .gte("meeting_at", rangeStartUtcIso)
        .lt("meeting_at", rangeEndUtcIso);

      if (mtgRes.error) throw new Error(mtgRes.error.message);

      const nowMs = Date.now();
      const rowsMeet = (mtgRes.data ?? []) as any[];

      const bookedOccurredBy: Record<string, number> = {};
      const bookedShowedBy: Record<string, number> = {};

      const takenTotal: Record<string, number> = {};
      const takenShowed: Record<string, number> = {};
      const takenMoved: Record<string, number> = {};

      rowsMeet.forEach((m: any) => {
        const b = m.booked_by_id ?? null;
        const a = m.attended_by_id ?? null;

        const t = Date.parse(m.meeting_at);
        const occurred = Number.isFinite(t) && t <= nowMs;
        if (!occurred) return;

        const showed = m.showed_up === true;

        // BOOKER-owned show rate (independent of taker)
        if (b) {
          bookedOccurredBy[b] = (bookedOccurredBy[b] ?? 0) + 1;
          if (showed) bookedShowedBy[b] = (bookedShowedBy[b] ?? 0) + 1;
        }

        // TAKER-owned move rate (person-specific)
        if (a) {
          takenTotal[a] = (takenTotal[a] ?? 0) + 1;

          if (showed) {
            takenShowed[a] = (takenShowed[a] ?? 0) + 1;
            if (m.moved_to_ss2 === true) takenMoved[a] = (takenMoved[a] ?? 0) + 1;
          }
        }
      });

      const leaders: LeaderRow[] = staff.map((u) => {
        const booked_kpi = Math.round(bookedKpiByUser[u.id] ?? 0);

        const booked_occurred = bookedOccurredBy[u.id] ?? 0;
        const booked_showed = bookedShowedBy[u.id] ?? 0;

        const showRate =
          booked_occurred > 0
            ? pctOrDash(booked_showed, booked_occurred)
            : { pctText: "—", numer: booked_showed, denom: booked_occurred };

        const taken_total = takenTotal[u.id] ?? 0;
        const taken_showed = takenShowed[u.id] ?? 0;
        const taken_moved = takenMoved[u.id] ?? 0;

        const moveRate = pctOrDash(taken_moved, taken_showed);

        return {
          user_id: u.id,
          name: u.full_name ?? u.id,

          booked_kpi,

          booked_occurred,
          booked_showed,
          show_rate_text: showRate.pctText,

          taken_total,
          taken_showed,
          taken_moved,
          move_rate_text: moveRate.pctText,
        };
      });

      // Sort: booked_occurred desc, then show rate desc, then move rate desc, then taken_showed desc
      leaders.sort((a, b) => {
        if (b.booked_occurred !== a.booked_occurred) return b.booked_occurred - a.booked_occurred;

        const ap = a.show_rate_text === "—" ? -1 : Number(a.show_rate_text.replace("%", ""));
        const bp = b.show_rate_text === "—" ? -1 : Number(b.show_rate_text.replace("%", ""));
        if (bp !== ap) return bp - ap;

        const am = a.move_rate_text === "—" ? -1 : Number(a.move_rate_text.replace("%", ""));
        const bm = b.move_rate_text === "—" ? -1 : Number(b.move_rate_text.replace("%", ""));
        if (bm !== am) return bm - am;

        return (b.taken_showed ?? 0) - (a.taken_showed ?? 0);
      });

      setTeamLeaders(leaders);
      setLoading(false);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to load hub.");
      setLoading(false);
    }
  }, [
    router,
    todayISO,
    leaderboardMode,
    rangeStartISO,
    rangeEndExclusiveISO,
    rangeStartUtcIso,
    rangeEndUtcIso,
    loadWeeklyTargetsSafe,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const kpiTone: AlertCardTone = todaySubmitted ? "green" : "amber";

  if (loading) return <div className="py-4 text-black">Loading…</div>;

  const weeklyTargetsText =
  !weeklyTargets
    ? "Weekly targets: Not set"
    : (() => {
        const parts: string[] = [];

        if (weeklyTargets.booked !== null) {
          parts.push(`Booked ${weeklyTargets.booked}`);
        }

        if (weeklyTargets.show_rate !== null) {
          parts.push(`Show rate ${weeklyTargets.show_rate}%`);
        }

        if (weeklyTargets.move_rate !== null) {
          parts.push(`SS2 ${weeklyTargets.move_rate}%`);
        }

        return parts.length
          ? `Weekly targets: ${parts.join(" • ")}`
          : "Weekly targets: Not set";
      })();

  return (
    <div className="text-black">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-semibold">Hub</h1>
          <div className="mt-1 text-xs text-black/70">Leaderboard • KPIs • Meetings</div>
          <div className="mt-1 text-[11px] text-black/50">
            Logged in as: <span className="font-medium">{myRole || "user"}</span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-2 flex-wrap justify-end items-center">
            <QuickActionsDropdown router={router} isAdmin={isAdmin} />
            <button onClick={load} className="rounded-xl border px-4 py-2 text-sm bg-white">
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="mb-4">
        <FocusTimer />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <AlertCard
          tone={kpiTone}
          title="📌 Today’s KPI"
          description={todaySubmitted ? `Submitted for today (${todayISO}).` : `Not submitted yet for today (${todayISO}).`}
          ctaLabel={todaySubmitted ? "Edit" : "Submit"}
          onClick={() => router.push(ROUTES.dailyKpis)}
        />

        <AlertCard
          tone="blue"
          title="📅 Meetings"
          description="Update outcomes (showed up / moved to SS2) and who booked/took the meeting."
          ctaLabel="Open"
          onClick={() => router.push(ROUTES.meetings)}
        />
      </div>

      {/* LEADERBOARD */}
      <div className="rounded-2xl border bg-white p-4 mb-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold">🏆 Team leaderboard ({leaderboardMode})</div>
            <div className="mt-1 text-xs text-black/60">
              Period: {fmtRangeShort(rangeStartISO, rangeEndExclusiveISO)}
            </div>

            <div className="mt-2 text-[11px] text-black/50 whitespace-pre-line">
              {"Show rate (Booked-by) = booked_showed / booked_occurred (regardless of who took it)"}
              {"\n"}
              {"Move rate (Taken-by) = taken_moved / taken_showed"}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setLeaderboardMode("weekly")}
              className={`rounded-xl border px-3 py-2 text-xs ${
                leaderboardMode === "weekly" ? "bg-black text-white" : "bg-white text-black"
              }`}
              type="button"
            >
              Weekly
            </button>
            <button
              onClick={() => setLeaderboardMode("monthly")}
              className={`rounded-xl border px-3 py-2 text-xs ${
                leaderboardMode === "monthly" ? "bg-black text-white" : "bg-white text-black"
              }`}
              type="button"
            >
              Monthly
            </button>
          </div>
        </div>

        {/* ✅ Weekly targets line */}
        <div className="mt-3 rounded-xl border bg-gray-50 px-3 py-2 text-xs text-black/70 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <span className="font-semibold text-black">{weeklyTargetsText}</span>
          </div>

          {isAdmin ? (
            <button
              onClick={() => router.push("/admin/kpi-templates")}
              className="rounded-lg border bg-white px-2 py-1 text-[11px] text-black"
              type="button"
            >
              Set targets
            </button>
          ) : null}
        </div>

        {teamLeaders.length === 0 ? (
          <div className="mt-3 text-sm text-black/60">No leaderboard data yet.</div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-black/60">
                  <th className="py-2">#</th>
                  <th className="py-2">Name</th>
                  <th className="py-2">Booked</th>
                  <th className="py-2">Shows</th>
                  <th className="py-2">Show rate</th>
                  <th className="py-2">Taken</th>
                  <th className="py-2">Moved</th>
                  <th className="py-2">Move rate</th>
                </tr>
              </thead>

              <tbody>
                {teamLeaders.slice(0, LEADERBOARD_LIMIT).map((r, idx) => (
                  <tr key={r.user_id} className="border-t">
                    <td className="py-2">{idx + 1}</td>
                    <td className="py-2 font-medium">{r.name}</td>

                    <td className="py-2">{safeNum(r.booked_kpi)}</td>

                    <td className="py-2">{safeNum(r.booked_showed)}</td>

                    <td className="py-2">
                      {r.show_rate_text}{" "}
                      <span className="text-[11px] text-black/40">
                        ({safeNum(r.booked_showed)}/{safeNum(r.booked_occurred)})
                      </span>
                    </td>

                    <td className="py-2">{safeNum(r.taken_showed)}</td>

                    <td className="py-2">{safeNum(r.taken_moved)}</td>

                    <td className="py-2">
                      {r.move_rate_text}{" "}
                      <span className="text-[11px] text-black/40">
                        ({safeNum(r.taken_moved)}/{safeNum(r.taken_showed)})
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-2 text-[11px] text-black/50">
              Sorted by booked occurred → show rate → move rate → taken.
            </div>
          </div>
        )}
      </div>

      {msg && (
        <div className="mt-6 rounded-xl border bg-gray-50 p-3 text-sm">
          {msg}
        </div>
      )}
    </div>
  );
}