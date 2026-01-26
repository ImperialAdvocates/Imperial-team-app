"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type AlertCardTone = "red" | "amber" | "green" | "blue";

const TEAM_ROLE = "setter"; // using setter as “team” bucket
const ADMIN_HUB_ROUTE = "/admin"; // your admin overview hub
const KPI_SETUP_ROUTE = "/admin/kpi-templates"; // KPI setup page (admin-only)
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
      <div className="mt-2 text-xs leading-relaxed opacity-80 whitespace-pre-line">
        {description}
      </div>

      {ctaLabel && onClick ? (
        <button
          onClick={onClick}
          className="mt-4 w-full rounded-xl bg-black px-3 py-2 text-xs text-white"
        >
          {ctaLabel}
        </button>
      ) : null}
    </div>
  );
}

/* ---------------- Data types ---------------- */

type TargetRow = {
  role: string;
  kpi_key: string;
  target_monthly: number | null;
  target_weekly: number | null;
  active: boolean;
};

type FieldRow = {
  key: string;
  label: string | null;
  active: boolean;
  input_type: string | null;
};

type HubMeetingRow = {
  id: string;
  lead_score: number | null;
  is_closed: boolean | null;
  owner_id?: string | null;
  booked_calendar_user_id?: string | null;
  booked_by_id?: string | null;
  discarded_at?: string | null;
};

type LeaderRow = {
  user_id: string;
  name: string;

  booked_kpi: number;

  occurred_booked_by: number;
  shows_booked_by: number;
  ss2_booked_by: number;
  closed_booked_by: number;

  taken: number;
  ss2_taken: number;
  closed_taken: number;

  score: number;
};

const ROUTES = {
  meetings: "/meetings",
  dailyKpis: "/daily-kpis",
  hotLeads: "/hot-leads",
  docsAll: "/documents",
  profile: "/profile",
} as const;

/* ---------------- Dropdown helpers ---------------- */

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

          <button
            onClick={() => go(ROUTES.meetings)}
            className="w-full px-3 py-3 text-left text-sm hover:bg-gray-50"
          >
            📅 Meetings
            <div className="text-xs text-black/50 mt-1">Update outcomes + booked by</div>
          </button>

          <div className="px-3 py-2 text-xs font-semibold text-black/60">KPIs</div>

          <button
            onClick={() => go(ROUTES.dailyKpis)}
            className="w-full px-3 py-3 text-left text-sm hover:bg-gray-50"
          >
            📌 Daily KPI Entry
            <div className="text-xs text-black/50 mt-1">Enter activity KPIs (dials, booked, etc.)</div>
          </button>

          <div className="px-3 py-2 text-xs font-semibold text-black/60">Hot leads</div>

          <button
            onClick={() => go(ROUTES.hotLeads)}
            className="w-full px-3 py-3 text-left text-sm hover:bg-gray-50"
          >
            🔥 Hot Leads
            <div className="text-xs text-black/50 mt-1">Score 3 leads assigned to you</div>
          </button>

          <div className="px-3 py-2 text-xs font-semibold text-black/60">Documents</div>

          <button
            onClick={() => go(ROUTES.docsAll)}
            className="w-full px-3 py-3 text-left text-sm hover:bg-gray-50"
          >
            📄 Documents
            <div className="text-xs text-black/50 mt-1">Company docs + resources</div>
          </button>

          <button
            onClick={() => go(ROUTES.profile)}
            className="w-full px-3 py-3 text-left text-sm hover:bg-gray-50"
          >
            👤 Profile
            <div className="text-xs text-black/50 mt-1">Logout or delete account</div>
          </button>

          {isAdmin ? (
            <>
              <div className="px-3 py-2 text-xs font-semibold text-black/60">Admin</div>

              <button
                onClick={() => go(ADMIN_HUB_ROUTE)}
                className="w-full px-3 py-3 text-left text-sm hover:bg-gray-50"
              >
                🛠 Admin Hub
                <div className="text-xs text-black/50 mt-1">Admin overview</div>
              </button>

              <button
                onClick={() => go(KPI_SETUP_ROUTE)}
                className="w-full px-3 py-3 text-left text-sm hover:bg-gray-50"
              >
                🎯 KPI Setup
                <div className="text-xs text-black/50 mt-1">Targets + assignments</div>
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

  const [myHotLeadsCount, setMyHotLeadsCount] = useState<number>(0);
  const [todaySubmitted, setTodaySubmitted] = useState<boolean>(false);

  const [targets, setTargets] = useState<TargetRow[]>([]);
  const [fieldsByKey, setFieldsByKey] = useState<Record<string, FieldRow>>({});

  // monthly leaderboard
  const [teamLeaders, setTeamLeaders] = useState<LeaderRow[]>([]);

  const todayISO = useMemo(() => toISODateMelb(new Date()), []);
  const { monthStartISO, monthEndExclusiveISO } = useMemo(
    () => businessMonthRangeISO(new Date()),
    []
  );

  // ✅ monthly targets for the “Monthly target” row
  const monthlyTargetsByKey = useMemo(() => {
    const m: Record<string, number> = {};
    (targets ?? []).forEach((t) => {
      m[t.kpi_key] = safeNum(t.target_monthly);
    });
    return m;
  }, [targets]);

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
      // Profile
      const myProfileRes = await supabase
        .from("profiles")
        .select("id, role, is_admin")
        .eq("id", uid)
        .single();

      if (myProfileRes.error) throw new Error(myProfileRes.error.message);

      const r = normRole(myProfileRes.data?.role);
      setMyRole(r);
      setIsAdmin(!!myProfileRes.data?.is_admin || r === "admin");

      // Hot leads (mine) — discarded removed from UI
      const hotRes = await supabase
        .from("meetings")
        .select(
          "id, lead_score, is_closed, owner_id, booked_calendar_user_id, booked_by_id, discarded_at"
        )
        .eq("lead_score", 3)
        .eq("is_closed", false);

      if (!hotRes.error) {
        const list = (hotRes.data ?? []) as unknown as HubMeetingRow[];
        const mine = list.filter((m) => {
          if (m.discarded_at) return false;
          const owner =
            (m.owner_id ?? m.booked_calendar_user_id ?? m.booked_by_id) ?? "";
          return owner === uid;
        });
        setMyHotLeadsCount(mine.length);
      } else {
        setMyHotLeadsCount(0);
      }

      // Today KPI submitted?
      const subRes = await supabase
        .from("kpi_daily_submissions")
        .select("id")
        .eq("user_id", uid)
        .eq("entry_date", todayISO)
        .maybeSingle();

      if (subRes.error) throw new Error(subRes.error.message);
      setTodaySubmitted(!!subRes.data);

      // KPI field labels
      const fieldsRes = await supabase
        .from("kpi_fields")
        .select("key, label, active, input_type")
        .eq("active", true);

      if (fieldsRes.error) throw new Error(fieldsRes.error.message);

      const fbk: Record<string, FieldRow> = {};
      (fieldsRes.data ?? []).forEach((f: any) => {
        fbk[f.key] = {
          key: f.key,
          label: f.label,
          active: f.active,
          input_type: f.input_type,
        };
      });
      setFieldsByKey(fbk);

      // ✅ Targets: pull BOTH monthly + weekly so the hub can show monthly targets correctly
      const tgtRes = await supabase
        .from("kpi_targets")
        .select("role, kpi_key, target_monthly, target_weekly, active")
        .eq("role", TEAM_ROLE)
        .order("kpi_key", { ascending: true });

      if (tgtRes.error) throw new Error(tgtRes.error.message);
      setTargets(((tgtRes.data ?? []) as TargetRow[]).filter((t) => !!t.kpi_key));

      // Staff list (for leaderboard)
      const profRes = await supabase.from("profiles").select("id, full_name");
      if (profRes.error) throw new Error(profRes.error.message);

      const staff = (profRes.data ?? []) as { id: string; full_name: string | null }[];
      const userIds = staff.map((p) => p.id).filter(Boolean);

      // Map field_id -> key
      const { data: fieldRows, error: fieldErr } = await supabase
        .from("kpi_fields")
        .select("id, key");
      if (fieldErr) throw new Error(fieldErr.message);

      const keyByFieldId: Record<string, string> = {};
      (fieldRows ?? []).forEach((f: any) => (keyByFieldId[f.id] = f.key));

      // ---------------- KPI SUBMISSIONS (MONTH) ----------------
      const bookedByUser: Record<string, number> = {};
      const apptFieldId =
        (fieldRows ?? []).find((f: any) => f.key === "appointments_booked")?.id ?? null;

      if (userIds.length > 0) {
        const subsAllRes = await supabase
          .from("kpi_daily_submissions")
          .select("id, user_id, entry_date")
          .in("user_id", userIds)
          .gte("entry_date", monthStartISO)
          .lt("entry_date", monthEndExclusiveISO);

        if (subsAllRes.error) throw new Error(subsAllRes.error.message);

        const subsAll = (subsAllRes.data ?? []) as any[];
        const subIds = subsAll.map((s) => s.id);
        const userBySubmission: Record<string, string> = {};
        subsAll.forEach((s) => {
          if (s?.id && s?.user_id) userBySubmission[s.id] = s.user_id;
        });

        if (subIds.length > 0) {
          const valsRes = await supabase
            .from("kpi_daily_values")
            .select("submission_id, field_id, value_text")
            .in("submission_id", subIds);

          if (valsRes.error) throw new Error(valsRes.error.message);

          (valsRes.data ?? []).forEach((v: any) => {
            const u = userBySubmission[v.submission_id];
            if (!u) return;

            const num = safeNum(v.value_text);
            if (!num) return;

            const key = keyByFieldId[v.field_id];

            if ((apptFieldId && v.field_id === apptFieldId) || key === "appointments_booked") {
              bookedByUser[u] = (bookedByUser[u] ?? 0) + num;
            }
          });
        }
      }

      // ---------------- MEETINGS (MONTH) ----------------
      // Discarded should still count for KPI, so do NOT filter discarded_at.
      const mtgRes = await supabase
        .from("meetings")
        .select("meeting_at, booked_by_id, attended_by_id, showed_up, moved_to_ss2, is_closed")
        .gte("meeting_at", `${monthStartISO}T00:00:00`)
        .lt("meeting_at", `${monthEndExclusiveISO}T00:00:00`);

      if (mtgRes.error) throw new Error(mtgRes.error.message);

      const nowMs = Date.now();
      const allMeetings = (mtgRes.data ?? []) as any[];

      const occurred = allMeetings.filter((m) => {
        const t = Date.parse(m.meeting_at);
        return Number.isFinite(t) && t <= nowMs;
      });

      // Outcomes per user (occurred only)
      const occurredBookedBy: Record<string, number> = {};
      const showsBookedBy: Record<string, number> = {};
      const ss2BookedBy: Record<string, number> = {};
      const closedBookedBy: Record<string, number> = {};

      const taken: Record<string, number> = {};
      const ss2Taken: Record<string, number> = {};
      const closedTaken: Record<string, number> = {};

      occurred.forEach((m: any) => {
        const b = m.booked_by_id;
        if (b) {
          occurredBookedBy[b] = (occurredBookedBy[b] ?? 0) + 1;
          if (m.showed_up) showsBookedBy[b] = (showsBookedBy[b] ?? 0) + 1;
          if (m.moved_to_ss2) ss2BookedBy[b] = (ss2BookedBy[b] ?? 0) + 1;
          if (m.is_closed) closedBookedBy[b] = (closedBookedBy[b] ?? 0) + 1;
        }

        const a = m.attended_by_id;
        if (a && m.showed_up) {
          taken[a] = (taken[a] ?? 0) + 1;
          if (m.moved_to_ss2) ss2Taken[a] = (ss2Taken[a] ?? 0) + 1;
          if (m.is_closed) closedTaken[a] = (closedTaken[a] ?? 0) + 1;
        }
      });

      // Weighted score: closes > SS2 > shows > booked
      const weights = {
        closedTaken: 100,
        ss2Taken: 20,
        showsBookedBy: 5,
        bookedKpi: 1,
      } as const;

      const leaderboardRows: LeaderRow[] = staff.map((u) => {
        const booked_kpi = bookedByUser[u.id] ?? 0;

        const shows_booked_by = showsBookedBy[u.id] ?? 0;
        const ss2_taken = ss2Taken[u.id] ?? 0;
        const closed_taken = closedTaken[u.id] ?? 0;

        const score =
          closed_taken * weights.closedTaken +
          ss2_taken * weights.ss2Taken +
          shows_booked_by * weights.showsBookedBy +
          booked_kpi * weights.bookedKpi;

        return {
          user_id: u.id,
          name: u.full_name ?? u.id,

          booked_kpi,

          occurred_booked_by: occurredBookedBy[u.id] ?? 0,
          shows_booked_by,
          ss2_booked_by: ss2BookedBy[u.id] ?? 0,
          closed_booked_by: closedBookedBy[u.id] ?? 0,

          taken: taken[u.id] ?? 0,
          ss2_taken,
          closed_taken,

          score,
        };
      });

      leaderboardRows.sort((a, b) => b.score - a.score);
      setTeamLeaders(leaderboardRows);

      setLoading(false);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to load hub.");
      setLoading(false);
    }
  }, [router, todayISO, monthStartISO, monthEndExclusiveISO]);

  useEffect(() => {
    load();
  }, [load]);

  const hotLeadTone: AlertCardTone = myHotLeadsCount > 0 ? "amber" : "green";
  const kpiTone: AlertCardTone = todaySubmitted ? "green" : "amber";

  if (loading) return <div className="py-4 text-black">Loading…</div>;

  return (
    <div className="text-black">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-semibold">Hub</h1>
          <div className="mt-1 text-xs text-black/70">
            Daily KPIs • Monthly leaderboard • Hot leads • Documents
          </div>
          <div className="mt-1 text-[11px] text-black/50">
            Logged in as: <span className="font-medium">{myRole || "user"}</span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-2 flex-wrap justify-end items-center">
            <QuickActionsDropdown router={router} isAdmin={isAdmin} />
            <button
              onClick={load}
              className="rounded-xl border px-4 py-2 text-sm bg-white"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* TOP PANELS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-3 mb-4">
        <AlertCard
          tone={hotLeadTone}
          title="🔥 Hot Leads"
          description={
            myHotLeadsCount > 0
              ? `You have ${myHotLeadsCount} hot lead${
                  myHotLeadsCount === 1 ? "" : "s"
                } assigned to you.`
              : "No hot leads assigned to you right now."
          }
          ctaLabel="Open"
          onClick={() => router.push(ROUTES.hotLeads)}
        />

        <AlertCard
          tone={kpiTone}
          title="📌 Today’s KPIs"
          description={
            todaySubmitted
              ? `Submitted for today (${todayISO}).`
              : `Not submitted yet for today (${todayISO}).`
          }
          ctaLabel={todaySubmitted ? "Edit" : "Submit"}
          onClick={() => router.push(ROUTES.dailyKpis)}
        />
      </div>

      {/* MONTHLY TEAM LEADERBOARD */}
      <div className="rounded-2xl border bg-white p-4 mb-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold">
              🏆 Team leaderboard (monthly)
            </div>
            <div className="mt-1 text-xs text-black/60">
              Period: {fmtRangeShort(monthStartISO, monthEndExclusiveISO)} •
              Occurred-only • Discarded still counts
            </div>
            <div className="mt-1 text-[11px] text-black/50">
              Ranking updates automatically based on weighted score (closes + SS2
              + shows + booked).
            </div>
          </div>
        </div>

        {teamLeaders.length === 0 ? (
          <div className="mt-3 text-sm text-black/60">
            No leaderboard data yet.
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-black/60">
                  <th className="py-2">#</th>
                  <th className="py-2">Name</th>
                  <th className="py-2">Booked</th>
                  <th className="py-2">Shows</th>
                  <th className="py-2">SS2</th>
                  <th className="py-2">Closed</th>
                  <th className="py-2">Taken</th>
                  <th className="py-2">SS2 (Taken)</th>
                  <th className="py-2">Closed (Taken)</th>
                </tr>
              </thead>

              <tbody>
                {/* ✅ Targets row (monthly) */}
                <tr className="border-t bg-gray-50">
                  <td className="py-2 font-medium" colSpan={2}>
                    Monthly target
                  </td>
                  <td className="py-2 font-medium">
                    {safeNum(monthlyTargetsByKey["appointments_booked"])}
                  </td>
                  <td className="py-2 font-medium">
                    {safeNum(monthlyTargetsByKey["meetings_attended"])}
                  </td>
                  <td className="py-2 font-medium">
                    {safeNum(monthlyTargetsByKey["moved_to_ss2"])}
                  </td>
                  <td className="py-2 font-medium">
                    {safeNum(monthlyTargetsByKey["closed"])}
                  </td>
                  <td className="py-2 font-medium">—</td>
                  <td className="py-2 font-medium">—</td>
                  <td className="py-2 font-medium">—</td>
                </tr>

                {teamLeaders.slice(0, LEADERBOARD_LIMIT).map((r, idx) => (
                  <tr key={r.user_id} className="border-t">
                    <td className="py-2">{idx + 1}</td>
                    <td className="py-2 font-medium">{r.name}</td>
                    <td className="py-2">{r.booked_kpi}</td>
                    <td className="py-2">{r.shows_booked_by}</td>
                    <td className="py-2">{r.ss2_booked_by}</td>
                    <td className="py-2">{r.closed_booked_by}</td>
                    <td className="py-2">{r.taken}</td>
                    <td className="py-2">{r.ss2_taken}</td>
                    <td className="py-2">{r.closed_taken}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-2 text-[11px] text-black/50">
              Score = (Closed Taken×100) + (SS2 Taken×20) + (Shows×5) + (Booked×1)
            </div>
          </div>
        )}
      </div>

      {/* DOCUMENTS */}
      <div className="rounded-2xl border bg-white p-5 mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-sm font-semibold">📄 Documents</div>
            <div className="mt-1 text-xs text-black/70">
              Store scripts, templates, and internal docs here.
            </div>
          </div>

          <button
            onClick={() => router.push(ROUTES.docsAll)}
            className="rounded-xl bg-black px-4 py-2 text-xs text-white"
          >
            Open Documents
          </button>
        </div>
      </div>

      {msg && (
        <div className="mt-6 rounded-xl border bg-gray-50 p-3 text-sm">
          {msg}
        </div>
      )}
    </div>
  );
}