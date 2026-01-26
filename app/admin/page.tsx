"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Tone = "red" | "amber" | "green" | "blue";

const TEAM_ROLE = "setter"; // using setter as “team” bucket
const KPI_SETUP_ROUTE = "/admin/kpi-templates";
const ADMIN_PERFORMANCE_ROUTE = "/admin/performance";

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

function pctFrom(achieved: number, target: number) {
  if (!target || Number.isNaN(target)) return "—";
  return `${Math.round((achieved / target) * 100)}%`;
}

function pctRatio(num: number, den: number) {
  if (!den || den <= 0) return "—";
  return `${Math.round((num / den) * 100)}%`;
}

/**
 * Business month:
 * - starts on the 26th
 * - ends (exclusive) on the 26th of next month
 */
function businessMonthRangeISO(now: Date) {
  // Use Melbourne calendar date for the "day" decision
  const nowISO = melbISO(now); // YYYY-MM-DD (Melbourne)
  const y = Number(nowISO.slice(0, 4));
  const m = Number(nowISO.slice(5, 7)) - 1; // JS month 0-11
  const d = Number(nowISO.slice(8, 10));

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (d >= 26) start.setFullYear(y, m, 26);
  else start.setFullYear(y, m - 1, 26);

  const endExclusive = new Date(start);
  endExclusive.setMonth(endExclusive.getMonth() + 1);
  endExclusive.setDate(26);
  endExclusive.setHours(0, 0, 0, 0);

  return {
    monthStartISO: melbISO(start),
    monthEndExclusiveISO: melbISO(endExclusive),
  };
}

function fmtMonthLabel(startISO: string, endExclusiveISO: string) {
  const end = new Date(`${endExclusiveISO}T00:00:00`);
  end.setDate(end.getDate() - 1);
  return `${startISO} → ${melbISO(end)}`;
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

function Panel({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-black">{title}</div>
        {right}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

type ProfileRow = { id: string; role: string | null; is_admin: boolean | null };

type TargetRow = {
  role: string;
  kpi_key: string;
  target_monthly: number | null;
  target_weekly: number | null;
  active: boolean;
};

type MeetingOutcomeRow = {
  id: string;
  meeting_at: string;
  booked_by_id: string | null;
  showed_up: boolean | null;
  moved_to_ss2: boolean | null;
  is_closed: boolean | null;
  discarded_at: string | null;
  lead_score: number | null;
  owner_id: string | null;
  booked_calendar_user_id: string | null;
};

function ownerIdForHotLead(m: MeetingOutcomeRow) {
  return m.owner_id ?? m.booked_by_id ?? m.booked_calendar_user_id ?? null;
}

export default function AdminControlCentrePage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const todayISO = useMemo(() => melbISO(new Date()), []);
  const { monthStartISO, monthEndExclusiveISO } = useMemo(
    () => businessMonthRangeISO(new Date()),
    []
  );
  const monthLabel = useMemo(
    () => fmtMonthLabel(monthStartISO, monthEndExclusiveISO),
    [monthStartISO, monthEndExclusiveISO]
  );

  const [adminUid, setAdminUid] = useState<string>("");

  // hot leads
  const [hotTotal, setHotTotal] = useState(0);
  const [hotUnassigned, setHotUnassigned] = useState(0);
  const [hotMine, setHotMine] = useState(0);

  // today
  const [todayMeetings, setTodayMeetings] = useState(0);
  const [todayClosed, setTodayClosed] = useState(0);

  // monthly targets map: key -> target_monthly
  const [targets, setTargets] = useState<Record<string, number>>({});

  // monthly totals
  const [mBooked, setMBooked] = useState(0); // KPI: appointments_booked (team)
  const [mShows, setMShows] = useState(0); // meetings: showed_up
  const [mSS2, setMSS2] = useState(0); // meetings: moved_to_ss2
  const [mClosed, setMClosed] = useState(0); // meetings: is_closed

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
    setAdminUid(uid);

    try {
      // --- Require admin ---
      const meRes = await supabase
        .from("profiles")
        .select("id, role, is_admin")
        .eq("id", uid)
        .single();

      if (meRes.error) throw new Error(meRes.error.message);

      const role = normRole(meRes.data?.role);
      const adminFlag = !!meRes.data?.is_admin || role === "admin";
      if (!adminFlag) {
        router.push("/hub");
        return;
      }

      // --- Targets (MONTHLY) ---
      const tRes = await supabase
        .from("kpi_targets")
        .select("role, kpi_key, target_monthly, target_weekly, active")
        .eq("role", TEAM_ROLE)
        .eq("active", true);

      if (tRes.error) throw new Error(tRes.error.message);

      const tMap: Record<string, number> = {};
      (tRes.data as TargetRow[] | null)?.forEach((r) => {
        // admin hub uses MONTHLY
        tMap[r.kpi_key] = Number(r.target_monthly ?? 0) || 0;
      });
      setTargets(tMap);

      // --- All users (sum across everyone) ---
      const profRes = await supabase.from("profiles").select("id, role, is_admin");
      if (profRes.error) throw new Error(profRes.error.message);

      const allUserIds = ((profRes.data as ProfileRow[] | null) ?? [])
        .map((p) => p.id)
        .filter(Boolean);

      // --- MONTHLY booked (KPI entries) ---
      const subsRes = await supabase
        .from("kpi_daily_submissions")
        .select("id, user_id")
        .in("user_id", allUserIds.length ? allUserIds : [uid])
        .gte("entry_date", monthStartISO)
        .lt("entry_date", monthEndExclusiveISO);

      if (subsRes.error) throw new Error(subsRes.error.message);

      const subIds = (subsRes.data ?? []).map((s: any) => s.id);
      let bookedSum = 0;

      if (subIds.length) {
        // Pull all values; filter in JS to avoid join complexity
        const valsRes = await supabase
          .from("kpi_daily_values")
          .select("submission_id, value_text, field_key, field_id");

        if (valsRes.error) throw new Error(valsRes.error.message);

        const { data: fieldRows, error: fErr } = await supabase
          .from("kpi_fields")
          .select("id, key");

        if (fErr) throw new Error(fErr.message);

        const keyById: Record<string, string> = {};
        (fieldRows ?? []).forEach((f: any) => (keyById[f.id] = f.key));

        const relevant = (valsRes.data ?? []).filter((v: any) =>
          subIds.includes(v.submission_id)
        );

        for (const v of relevant) {
          const key = String(v.field_key ?? keyById[v.field_id] ?? "");
          if (key !== "appointments_booked") continue;

          const num = Number(String(v.value_text ?? "").trim());
          if (!Number.isNaN(num)) bookedSum += num;
        }
      }

      setMBooked(bookedSum);

      // --- MONTHLY outcomes (meetings table) ---
      // IMPORTANT: Discarded should still count toward KPI totals, so we DO NOT filter discarded_at here.
      const startMelb = new Date(`${monthStartISO}T00:00:00+11:00`);
      const endMelb = new Date(`${monthEndExclusiveISO}T00:00:00+11:00`);

      const mtgRes = await supabase
        .from("meetings")
        .select("id, meeting_at, showed_up, moved_to_ss2, is_closed, discarded_at")
        .gte("meeting_at", startMelb.toISOString())
        .lt("meeting_at", endMelb.toISOString());

      if (mtgRes.error) throw new Error(mtgRes.error.message);

      // occurred-only (meetings that have already happened)
      const nowMs = Date.now();
      const occurred = (mtgRes.data ?? []).filter((m: any) => {
        const t = Date.parse(m.meeting_at);
        return Number.isFinite(t) && t <= nowMs;
      });

      setMShows(occurred.filter((m: any) => !!m.showed_up).length);
      setMSS2(occurred.filter((m: any) => !!m.moved_to_ss2).length);
      setMClosed(occurred.filter((m: any) => !!m.is_closed).length);

      // --- Hot leads counts (discarded excluded in UI) ---
      const hotRes = await supabase
        .from("meetings")
        .select("id, owner_id, booked_by_id, booked_calendar_user_id, lead_score, is_closed, discarded_at")
        .eq("lead_score", 3)
        .eq("is_closed", false)
        .is("discarded_at", null);

      if (hotRes.error) throw new Error(hotRes.error.message);

      const hotList = (hotRes.data ?? []) as unknown as MeetingOutcomeRow[];
      setHotTotal(hotList.length);
      setHotUnassigned(hotList.filter((m) => !ownerIdForHotLead(m)).length);
      setHotMine(hotList.filter((m) => ownerIdForHotLead(m) === uid).length);

      // --- Today meetings (discarded excluded in UI) ---
      const todayStartMelb = new Date(`${todayISO}T00:00:00+11:00`);
      const todayEndMelb = new Date(`${todayISO}T23:59:59.999+11:00`);

      const todayRes = await supabase
        .from("meetings")
        .select("id, is_closed, meeting_at")
        .gte("meeting_at", todayStartMelb.toISOString())
        .lte("meeting_at", todayEndMelb.toISOString())
        .is("discarded_at", null);

      if (todayRes.error) {
        setTodayMeetings(0);
        setTodayClosed(0);
      } else {
        const m = todayRes.data ?? [];
        setTodayMeetings(m.length);
        setTodayClosed(m.filter((r: any) => !!r.is_closed).length);
      }

      setLoading(false);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to load admin overview.");
      setLoading(false);
    }
  }, [router, todayISO, monthStartISO, monthEndExclusiveISO]);

  useEffect(() => {
    load();
  }, [load]);

  const tBooked = targets["appointments_booked"] ?? 0;
  const tShows = targets["meetings_attended"] ?? 0;
  const tSS2 = targets["moved_to_ss2"] ?? 0;
  const tClosed = targets["closed"] ?? 0;

  const showRate = pctRatio(mShows, mBooked);

  const hotTone: Tone = hotUnassigned > 0 ? "amber" : hotTotal > 0 ? "blue" : "green";
  const closeTone: Tone = tClosed > 0 && mClosed < tClosed ? "amber" : "green";

  if (loading) return <div className="p-6 text-black">Loading…</div>;

  return (
    <div className="min-h-[100dvh] bg-gray-50 p-4 text-black">
      <div className="mx-auto w-full max-w-md">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="text-xs text-black/60">Admin</div>
            <h1 className="text-2xl font-semibold">Admin Overview</h1>
            <div className="mt-1 text-xs text-black/60">
              Month: {monthLabel} • Today (Melbourne): {todayISO}
            </div>
            <div className="mt-1 text-[11px] text-black/50">
              Admin view is overall (team totals). Discarded meetings are hidden in UI but still count for KPI totals.
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

        <div className="grid grid-cols-2 gap-3 mb-3">
          <StatCard
            title="Hot leads"
            value={n(hotTotal)}
            subtitle={`Unassigned: ${n(hotUnassigned)} • Mine: ${n(hotMine)}`}
            tone={hotTone}
            onClick={() => router.push("/admin/hot-leads")}
          />

          <StatCard
            title="Meetings today"
            value={n(todayMeetings)}
            subtitle={`Closed today: ${n(todayClosed)}`}
            tone="blue"
            onClick={() => router.push("/meetings")}
          />
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <StatCard
            title="Booked (this month)"
            value={n(mBooked)}
            subtitle={`Target: ${n(tBooked)} • ${pctFrom(mBooked, tBooked)} • Show rate: ${showRate}`}
            tone="green"
            onClick={() => router.push("/daily-kpis")}
          />

          <StatCard
            title="Shows (this month)"
            value={n(mShows)}
            subtitle={`Target: ${n(tShows)} • ${pctFrom(mShows, tShows)}`}
            tone="green"
            onClick={() => router.push("/meetings")}
          />
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <StatCard
            title="SS2 (this month)"
            value={n(mSS2)}
            subtitle={`Target: ${n(tSS2)} • ${pctFrom(mSS2, tSS2)}`}
            tone="green"
            onClick={() => router.push("/meetings")}
          />

          <StatCard
            title="Closed (this month)"
            value={n(mClosed)}
            subtitle={`Target: ${n(tClosed)} • ${pctFrom(mClosed, tClosed)}`}
            tone={closeTone}
            onClick={() => router.push("/meetings")}
          />
        </div>

        <div className="space-y-3">
          <Panel
            title="Priority"
            right={
              <button
                onClick={() => router.push("/admin/hot-leads")}
                className="rounded-xl border bg-white px-3 py-2 text-xs"
              >
                Open hot leads
              </button>
            }
          >
            {hotUnassigned > 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <div className="font-semibold">Unassigned hot leads: {hotUnassigned}</div>
                <div className="text-xs opacity-80 mt-1">Assign owners so nothing gets missed.</div>
              </div>
            ) : hotTotal > 0 ? (
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
                <div className="font-semibold">Hot leads in play: {hotTotal}</div>
                <div className="text-xs opacity-80 mt-1">Check the queue.</div>
              </div>
            ) : (
              <div className="rounded-xl border border-green-200 bg-green-50 p-3">
                <div className="font-semibold">No hot leads ✅</div>
                <div className="text-xs opacity-80 mt-1">Focus on bookings and outcomes.</div>
              </div>
            )}
          </Panel>

          <Panel
            title="Admin tools"
            right={
              <button
                onClick={() => router.push(KPI_SETUP_ROUTE)}
                className="rounded-xl bg-black px-3 py-2 text-xs text-white"
              >
                KPI Setup
              </button>
            }
          >
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => router.push("/admin/hot-leads")}
                className="rounded-xl border bg-white px-3 py-3 text-left"
              >
                <div className="text-sm font-semibold">Hot Leads</div>
                <div className="text-xs text-black/60 mt-1">Owners + queue</div>
              </button>

              <button
                onClick={() => router.push("/meetings")}
                className="rounded-xl border bg-white px-3 py-3 text-left"
              >
                <div className="text-sm font-semibold">Meetings</div>
                <div className="text-xs text-black/60 mt-1">Shows, SS2, closes</div>
              </button>

              <button
                onClick={() => router.push("/daily-kpis")}
                className="rounded-xl border bg-white px-3 py-3 text-left"
              >
                <div className="text-sm font-semibold">Daily KPI Entry</div>
                <div className="text-xs text-black/60 mt-1">Activity KPIs</div>
              </button>

              {/* ✅ Replace duplicate KPI Setup card with Performance */}
              <button
                onClick={() => router.push(ADMIN_PERFORMANCE_ROUTE)}
                className="rounded-xl border bg-white px-3 py-3 text-left"
              >
                <div className="text-sm font-semibold">Performance</div>
                <div className="text-xs text-black/60 mt-1">Per-person breakdown</div>
              </button>
            </div>

            <div className="mt-3 text-[11px] text-black/50">
              KPI totals include discarded meetings (they’re hidden from UI lists, but still counted).
            </div>
          </Panel>
        </div>

        {msg && <div className="mt-4 rounded-xl border bg-gray-50 p-3 text-sm text-black">{msg}</div>}
      </div>
    </div>
  );
}