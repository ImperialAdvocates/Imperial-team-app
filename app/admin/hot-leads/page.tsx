"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ProfileRow = {
  id: string;
  full_name: string | null;
  role?: string | null;
  is_admin?: boolean | null;
};

type MeetingRow = {
  id: string;
  meeting_name: string | null;
  meeting_at: string; // timestamptz

  booked_by_id: string | null;
  attended_by_id: string | null;
  booked_calendar_user_id: string | null;

  lead_score: number | null;
  is_closed: boolean | null;
  discarded_at: string | null;

  owner_id: string | null;
};

function normRole(r?: string | null) {
  return (r ?? "").trim().toLowerCase();
}

function fmtDateTimeAU(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/**
 * ✅ Stable hot lead ownership:
 * - owner_id (explicit)
 * - booked_by_id (setter who booked)
 * - booked_calendar_user_id (fallback)
 *
 * NOTE: We intentionally do NOT treat attended_by_id as "owner"
 * because that would make ownership flip as closers get assigned.
 */
function ownerIdForMeeting(m: MeetingRow) {
  return m.owner_id ?? m.booked_by_id ?? m.booked_calendar_user_id ?? null;
}

function initials(name?: string | null) {
  const n = (name ?? "").trim();
  if (!n) return "—";
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function AdminHotLeadsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [savingMeetingId, setSavingMeetingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [isAdmin, setIsAdmin] = useState(false);
  const [adminUid, setAdminUid] = useState<string>("");

  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);

  const [q, setQ] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<string>("ALL"); // ALL | UNASSIGNED | <uuid>

  const profilesById = useMemo(() => {
    const map: Record<string, ProfileRow> = {};
    profiles.forEach((p) => (map[p.id] = p));
    return map;
  }, [profiles]);

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
      const meRes = await supabase
        .from("profiles")
        .select("id, role, is_admin")
        .eq("id", uid)
        .single();

      if (meRes.error) throw new Error(meRes.error.message);

      const role = normRole(meRes.data?.role);
      const adminFlag = !!meRes.data?.is_admin || role === "admin";
      setIsAdmin(adminFlag);

      if (!adminFlag) {
        router.push("/hub");
        return;
      }

      const profRes = await supabase
        .from("profiles")
        .select("id, full_name, role, is_admin")
        .order("full_name", { ascending: true });

      if (profRes.error) throw new Error(profRes.error.message);
      setProfiles((profRes.data ?? []) as ProfileRow[]);

      const hotRes = await supabase
        .from("meetings")
        .select(
          `
          id,
          meeting_name,
          meeting_at,
          booked_by_id,
          attended_by_id,
          booked_calendar_user_id,
          lead_score,
          is_closed,
          discarded_at,
          owner_id
        `
        )
        .eq("lead_score", 3)
        .eq("is_closed", false)
        .is("discarded_at", null)
        .order("meeting_at", { ascending: false });

      if (hotRes.error) throw new Error(hotRes.error.message);

      setMeetings((hotRes.data ?? []) as MeetingRow[]);
      setLoading(false);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to load admin hot leads.");
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  async function adminAssignOwner(meetingId: string, ownerIdRaw: string) {
    setSavingMeetingId(meetingId);
    setMsg(null);

    // ✅ Allow clearing owner (Unassigned)
    const owner = ownerIdRaw?.trim() ? ownerIdRaw.trim() : null;

    const { error } = await supabase.rpc("admin_set_hot_lead_owner", {
      p_meeting_id: meetingId,
      p_owner: owner,
    });

    if (error) {
      setMsg(error.message);
      setSavingMeetingId(null);
      return;
    }

    await load();
    setSavingMeetingId(null);
  }

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();

    const list = meetings.filter((m) => {
      const ownerId = ownerIdForMeeting(m);

      if (ownerFilter === "UNASSIGNED") {
        if (ownerId) return false;
      } else if (ownerFilter !== "ALL") {
        if (ownerId !== ownerFilter) return false;
      }

      if (qq) {
        const name = (m.meeting_name ?? "").toLowerCase();
        if (!name.includes(qq)) return false;
      }

      return true;
    });

    // ✅ UNASSIGNED FIRST, then newest
    return list.sort((a, b) => {
      const ao = ownerIdForMeeting(a);
      const bo = ownerIdForMeeting(b);
      if (!ao && bo) return -1;
      if (ao && !bo) return 1;
      return new Date(b.meeting_at).getTime() - new Date(a.meeting_at).getTime();
    });
  }, [meetings, q, ownerFilter]);

  const stats = useMemo(() => {
    const total = meetings.length;
    const unassigned = meetings.filter((m) => !ownerIdForMeeting(m)).length;
    return { total, unassigned, showing: filtered.length };
  }, [meetings, filtered]);

  // ✅ Owner counts (for overview chips)
  const ownerCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    let unassigned = 0;

    meetings.forEach((m) => {
      const oid = ownerIdForMeeting(m);
      if (!oid) {
        unassigned += 1;
        return;
      }
      counts[oid] = (counts[oid] ?? 0) + 1;
    });

    const rows = Object.entries(counts)
      .map(([ownerId, count]) => ({
        ownerId,
        ownerName: profilesById[ownerId]?.full_name ?? "Unknown",
        count,
      }))
      .sort((a, b) => b.count - a.count || a.ownerName.localeCompare(b.ownerName));

    return { rows, unassigned, total: meetings.length };
  }, [meetings, profilesById]);

  if (loading) return <div className="p-6 text-black">Loading…</div>;

  return (
    <div className="min-h-[100dvh] bg-gray-50 p-4 text-black">
      <div className="mx-auto w-full max-w-5xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="text-xs text-black/60">Admin</div>
            <h1 className="text-2xl font-semibold">Hot Leads</h1>
            <div className="mt-1 text-xs text-black/60">
              All hot leads (score=3) • not closed • not discarded • searchable + filterable per staff member
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={load} className="rounded-xl border bg-white px-3 py-2 text-xs">
              Refresh
            </button>
            <button onClick={() => router.push("/admin")} className="rounded-xl border bg-white px-3 py-2 text-xs">
              Back
            </button>
          </div>
        </div>

        {/* ✅ Owner summary */}
        <div className="rounded-2xl border bg-white p-4 mb-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm font-semibold">Hot leads by owner</div>
            <div className="text-xs text-black/60">Total: {ownerCounts.total}</div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => setOwnerFilter("ALL")}
              className={`rounded-full border px-3 py-1 text-xs ${ownerFilter === "ALL" ? "bg-black text-white" : "bg-white"}`}
            >
              All ({ownerCounts.total})
            </button>

            <button
              onClick={() => setOwnerFilter("UNASSIGNED")}
              className={`rounded-full border px-3 py-1 text-xs ${
                ownerFilter === "UNASSIGNED" ? "bg-black text-white" : "bg-white"
              }`}
            >
              Unassigned ({ownerCounts.unassigned})
            </button>

            {adminUid ? (
              <button
                onClick={() => setOwnerFilter(adminUid)}
                className={`rounded-full border px-3 py-1 text-xs ${
                  ownerFilter === adminUid ? "bg-black text-white" : "bg-white"
                }`}
              >
                Mine ({meetings.filter((m) => ownerIdForMeeting(m) === adminUid).length})
              </button>
            ) : null}

            {ownerCounts.rows.map((r) => (
              <button
                key={r.ownerId}
                onClick={() => setOwnerFilter(r.ownerId)}
                className={`rounded-full border px-3 py-1 text-xs ${
                  ownerFilter === r.ownerId ? "bg-black text-white" : "bg-white"
                }`}
                title="Filter by owner"
              >
                {r.ownerName} ({r.count})
              </button>
            ))}

            <div className="ml-auto text-[11px] text-black/50 self-center">
              Showing <b>{stats.showing}</b>
            </div>
          </div>

          <div className="mt-2 text-[11px] text-black/50">
            Ownership = <code>meetings.owner_id</code> (preferred), otherwise booked by. Assigning owner updates{" "}
            <code>meetings.owner_id</code>.
          </div>
        </div>

        {/* Controls */}
        <div className="rounded-2xl border bg-white p-4 mb-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="md:col-span-2">
              <div className="text-xs font-semibold text-black/60">Search</div>
              <input
                className="mt-2 w-full rounded-xl border px-3 py-2 text-sm"
                placeholder="Search meeting name…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>

            <div>
              <div className="text-xs font-semibold text-black/60">Filter by owner</div>
              <select
                className="mt-2 w-full rounded-xl border px-3 py-2 text-sm bg-white"
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
              >
                <option value="ALL">All owners</option>
                <option value="UNASSIGNED">Unassigned</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name ?? p.id}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Quick chips */}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => setOwnerFilter("ALL")}
              className={`rounded-full border px-3 py-1 text-xs ${ownerFilter === "ALL" ? "bg-black text-white" : "bg-white"}`}
            >
              All ({stats.total})
            </button>

            <button
              onClick={() => setOwnerFilter("UNASSIGNED")}
              className={`rounded-full border px-3 py-1 text-xs ${
                ownerFilter === "UNASSIGNED" ? "bg-black text-white" : "bg-white"
              }`}
            >
              Unassigned ({stats.unassigned})
            </button>

            {adminUid ? (
              <button
                onClick={() => setOwnerFilter(adminUid)}
                className={`rounded-full border px-3 py-1 text-xs ${
                  ownerFilter === adminUid ? "bg-black text-white" : "bg-white"
                }`}
              >
                Mine
              </button>
            ) : null}

            <div className="ml-auto text-[11px] text-black/50 self-center">
              Showing <b>{stats.showing}</b>
            </div>
          </div>
        </div>

        {/* List */}
        {filtered.length === 0 ? (
          <div className="rounded-2xl border bg-white p-6 text-sm text-black/70">No matching hot leads ✅</div>
        ) : (
          <div className="space-y-3">
            {filtered.map((m) => {
              const derivedOwnerId = ownerIdForMeeting(m);
              const ownerName = derivedOwnerId ? profilesById[derivedOwnerId]?.full_name ?? "Unknown" : "Unassigned";
              const bookedName = m.booked_by_id ? profilesById[m.booked_by_id]?.full_name ?? "Unknown" : "—";
              const attendedName = m.attended_by_id ? profilesById[m.attended_by_id]?.full_name ?? "Unknown" : "—";

              const ownerBadge =
                derivedOwnerId ? "bg-white border text-black" : "bg-amber-50 border-amber-200 text-amber-900";

              return (
                <div key={m.id} className="rounded-2xl border bg-white p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    {/* Left */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-xl border bg-gray-50 flex items-center justify-center text-xs font-semibold">
                          {initials(m.meeting_name)}
                        </div>

                        <div className="min-w-0">
                          <div className="text-sm font-semibold truncate">{m.meeting_name || "Unnamed meeting"}</div>
                          <div className="mt-1 text-xs text-black/60">{fmtDateTimeAU(m.meeting_at)}</div>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs bg-red-50 border-red-200 text-red-700">
                          Hot lead
                        </span>

                        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs ${ownerBadge}`}>
                          Owner: <span className="ml-1 font-medium">{ownerName}</span>
                        </span>

                        <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs bg-white">
                          Booked: <span className="ml-1 font-medium">{bookedName}</span>
                        </span>

                        <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs bg-white">
                          Attended: <span className="ml-1 font-medium">{attendedName}</span>
                        </span>
                      </div>

                      {/* Admin owner assign */}
                      {isAdmin && (
                        <div className="mt-3">
                          <div className="text-xs text-black/60 mb-1">Assign owner</div>
                          <select
                            className="w-full rounded-xl border px-3 py-2 bg-white text-sm"
                            value={m.owner_id ?? ""}
                            disabled={savingMeetingId === m.id}
                            onChange={(e) => adminAssignOwner(m.id, e.target.value)}
                          >
                            <option value="">Unassigned</option>
                            {profiles.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.full_name ?? p.id}
                              </option>
                            ))}
                          </select>
                          <div className="mt-1 text-[11px] text-black/50">
                            Updates <code>meetings.owner_id</code> + <code>meeting_followups.owner_user_id</code>.
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Right */}
                    <div className="flex flex-col items-end gap-2">
                      <span className="text-[11px] text-black/40 font-mono">{m.id.slice(0, 8)}…</span>
                      <button
                        onClick={() => router.push("/meetings")}
                        className="rounded-xl bg-black px-3 py-2 text-xs text-white"
                        title="Go to Meetings"
                      >
                        Open meetings
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {msg && <div className="mt-4 rounded-xl border bg-gray-50 p-3 text-sm text-black">{msg}</div>}
      </div>
    </div>
  );
}