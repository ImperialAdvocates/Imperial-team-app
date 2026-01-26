"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

/* ---------------- Types ---------------- */

type ProfileRow = {
  id: string;
  full_name: string | null;
  role?: string | null;
  is_admin?: boolean | null;
};

type MeetingRow = {
  id: string;
  meeting_name: string | null;
  meeting_at: string;

  booked_by_id: string;
  attended_by_id: string;

  lead_score: number;
  showed_up: boolean;
  moved_to_ss2: boolean;

  is_closed: boolean;
  closed_at: string | null;

  booked_calendar_user_id: string | null;
  discarded_at?: string | null;

  created_at: string;
};

/* ---------------- Utils ---------------- */

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

/** For <input type="datetime-local"> we need "YYYY-MM-DDTHH:mm" */
function toDatetimeLocalValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function fromDatetimeLocalToIso(value: string) {
  const d = new Date(value);
  return d.toISOString();
}

function initials(name?: string | null) {
  const n = (name ?? "").trim();
  if (!n) return "—";
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/* ---------------- Component ---------------- */

export default function MeetingsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [userId, setUserId] = useState<string>("");
  const [myRole, setMyRole] = useState<string>("");
  const [isAdmin, setIsAdmin] = useState(false);

  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const profilesById = useMemo(() => {
    const m: Record<string, ProfileRow> = {};
    profiles.forEach((p) => (m[p.id] = p));
    return m;
  }, [profiles]);

  const [meetings, setMeetings] = useState<MeetingRow[]>([]);

  /* ---------------- Search ---------------- */
  const [search, setSearch] = useState("");

  const filteredMeetings = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return meetings;
    return meetings.filter((m) => (m.meeting_name ?? "").toLowerCase().includes(q));
  }, [meetings, search]);

  /* ---------------- Create form ---------------- */
  const [meetingName, setMeetingName] = useState<string>("");
  const [meetingAtLocal, setMeetingAtLocal] = useState(() => toDatetimeLocalValue(new Date()));

  const [bookedById, setBookedById] = useState<string>("");
  const [attendedById, setAttendedById] = useState<string>("");

  const [leadScore, setLeadScore] = useState<number>(1);
  const [showedUp, setShowedUp] = useState<boolean>(true);
  const [movedToSs2, setMovedToSs2] = useState<boolean>(false);
  const [isClosed, setIsClosed] = useState<boolean>(false);

  const [creating, setCreating] = useState(false);
  const [savingMeetingId, setSavingMeetingId] = useState<string | null>(null);

  /* ---------------- Load ---------------- */

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
    setUserId(uid);

    try {
      // me
      const meRes = await supabase.from("profiles").select("id, role, is_admin").eq("id", uid).single();
      if (meRes.error) throw new Error(meRes.error.message);

      const r = normRole(meRes.data?.role);
      setMyRole(r);

      const adminFlag = !!meRes.data?.is_admin || r === "admin";
      setIsAdmin(adminFlag);

      // profiles
      const pRes = await supabase
        .from("profiles")
        .select("id, full_name, role, is_admin")
        .order("full_name", { ascending: true });

      if (pRes.error) throw new Error(pRes.error.message);

      const profList = (pRes.data ?? []) as ProfileRow[];
      setProfiles(profList);

      // meetings (admin sees all; others see booked/taken by them)
      const base = supabase
        .from("meetings")
        .select(
          "id, meeting_name, meeting_at, booked_by_id, attended_by_id, lead_score, showed_up, moved_to_ss2, is_closed, closed_at, booked_calendar_user_id, created_at, discarded_at"
        )
        .is("discarded_at", null)
        .order("meeting_at", { ascending: false })
        .limit(300);

      const mtgRes = adminFlag ? await base : await base.or(`booked_by_id.eq.${uid},attended_by_id.eq.${uid}`);
      if (mtgRes.error) throw new Error(mtgRes.error.message);

      setMeetings((mtgRes.data ?? []) as MeetingRow[]);

      setLoading(false);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to load meetings.");
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  // defaults once profiles loaded
  useEffect(() => {
    if (!userId || profiles.length === 0) return;

    if (!bookedById) setBookedById(userId);
    if (!attendedById) setAttendedById(userId);
  }, [userId, profiles, bookedById, attendedById]);

  /* ---------------- Create meeting ---------------- */

  async function createMeeting() {
    setCreating(true);
    setMsg(null);

    try {
      if (!userId) throw new Error("Not logged in.");
      if (!bookedById) throw new Error("Select who booked it.");
      if (!attendedById) throw new Error("Select who took it.");

      const meetingAtIso = fromDatetimeLocalToIso(meetingAtLocal);

      const payload = {
        meeting_name: meetingName.trim() ? meetingName.trim() : null,
        meeting_at: meetingAtIso,
        booked_by_id: bookedById,
        attended_by_id: attendedById,
        lead_score: leadScore,
        showed_up: showedUp,
        moved_to_ss2: movedToSs2,
        booked_calendar_user_id: bookedById, // always mirror booked_by
        is_closed: isClosed,
        closed_at: isClosed ? new Date().toISOString() : null,
        discarded_at: null,
      };

      const { error } = await supabase.from("meetings").insert(payload);
      if (error) throw new Error(error.message);

      await load();

      // reset
      setMeetingName("");
      setLeadScore(1);
      setMovedToSs2(false);
      setShowedUp(true);
      setIsClosed(false);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to create meeting.");
    } finally {
      setCreating(false);
    }
  }

  /* ---------------- Save meeting edits ---------------- */

  async function saveMeetingUpdates(m: MeetingRow) {
    setSavingMeetingId(m.id);
    setMsg(null);

    try {
      const payload = {
        meeting_name: m.meeting_name,
        meeting_at: m.meeting_at,
        booked_by_id: m.booked_by_id,
        attended_by_id: m.attended_by_id,
        booked_calendar_user_id: m.booked_by_id, // always mirror booked_by
        lead_score: m.lead_score,
        showed_up: m.showed_up,
        moved_to_ss2: m.moved_to_ss2,
        is_closed: m.is_closed,
        closed_at: m.is_closed ? (m.closed_at ?? new Date().toISOString()) : null,
      };

      const { error } = await supabase.from("meetings").update(payload).eq("id", m.id);
      if (error) throw new Error(error.message);

      await load();
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to save meeting.");
    } finally {
      setSavingMeetingId(null);
    }
  }

  async function discardMeeting(meetingId: string) {
    const ok = window.confirm("Discard this meeting? It will disappear from the list but stay saved for KPIs.");
    if (!ok) return;

    setSavingMeetingId(meetingId);
    setMsg(null);

    try {
      const { error } = await supabase
        .from("meetings")
        .update({ discarded_at: new Date().toISOString() })
        .eq("id", meetingId);

      if (error) throw new Error(error.message);

      // remove locally immediately (snappier)
      setMeetings((prev) => prev.filter((m) => m.id !== meetingId));
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to discard meeting.");
    } finally {
      setSavingMeetingId(null);
    }
  }

  function patchMeeting(id: string, patch: Partial<MeetingRow>) {
    setMeetings((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  if (loading) return <div className="p-6 text-black">Loading…</div>;

  return (
    <div className="min-h-[100dvh] bg-gray-50 p-4 text-black">
      <div className="mx-auto w-full max-w-3xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h1 className="text-2xl font-semibold text-black">Meetings</h1>
            <div className="mt-1 text-xs text-black/60">
              Update outcomes here • Discard removes it from view but keeps history for KPIs.
            </div>
            <div className="mt-1 text-[11px] text-black/50">
              Logged in as: <span className="font-medium">{myRole || "user"}</span>
              {isAdmin ? " (admin)" : ""}
            </div>
          </div>

          <div className="flex gap-2 flex-wrap justify-end">
            <button
              onClick={() => router.push("/hot-leads")}
              className="rounded-xl border bg-white px-3 py-2 text-xs"
            >
              Hot Leads
            </button>
            <button onClick={() => router.push("/hub")} className="rounded-xl border bg-white px-3 py-2 text-xs">
              Hub
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="mb-4 rounded-2xl border bg-white p-4">
          <div className="text-xs font-semibold text-black/60">Search meetings</div>
          <input
            className="mt-2 w-full rounded-xl border px-3 py-2 text-sm text-black"
            placeholder="Type a name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Create */}
        <div className="rounded-2xl border bg-white p-5 mb-6">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-sm font-semibold text-black">Add meeting</h2>
              <div className="mt-1 text-xs text-black/60">Booker + taker + outcomes.</div>
            </div>

            <button
              onClick={createMeeting}
              disabled={creating}
              className="rounded-xl bg-black px-4 py-2 text-sm text-white disabled:opacity-60"
            >
              {creating ? "Creating…" : "Create"}
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-black">Meeting name</label>
              <input
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm text-black"
                placeholder="e.g. Sachin – SS1"
                value={meetingName}
                onChange={(e) => setMeetingName(e.target.value)}
              />
            </div>

            <div>
              <label className="text-xs font-medium text-black">Meeting date/time</label>
              <input
                type="datetime-local"
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm text-black"
                value={meetingAtLocal}
                onChange={(e) => setMeetingAtLocal(e.target.value)}
              />
            </div>

            <div>
              <label className="text-xs font-medium text-black">Booked by</label>
              <select
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white text-black"
                value={bookedById}
                onChange={(e) => setBookedById(e.target.value)}
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name ?? p.id}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-black">Taken by</label>
              <select
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white text-black"
                value={attendedById}
                onChange={(e) => setAttendedById(e.target.value)}
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name ?? p.id}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-black">Lead score</label>
              <select
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white text-black"
                value={String(leadScore)}
                onChange={(e) => setLeadScore(Number(e.target.value))}
              >
                <option value="1">1 (Cold)</option>
                <option value="2">2 (Warm)</option>
                <option value="3">3 (Hot)</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <div className="text-xs font-medium text-black mb-2">Outcomes</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm bg-white">
                  <span className="text-black">Showed up</span>
                  <input type="checkbox" className="h-4 w-4" checked={showedUp} onChange={(e) => setShowedUp(e.target.checked)} />
                </label>

                <label className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm bg-white">
                  <span className="text-black">Moved to SS2</span>
                  <input type="checkbox" className="h-4 w-4" checked={movedToSs2} onChange={(e) => setMovedToSs2(e.target.checked)} />
                </label>

                <label className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm bg-white">
                  <span className="text-black">Closed</span>
                  <input type="checkbox" className="h-4 w-4" checked={isClosed} onChange={(e) => setIsClosed(e.target.checked)} />
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* List */}
        <div className="rounded-2xl border bg-white p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-semibold text-black">{isAdmin ? "All meetings" : "Your meetings"}</h2>
            <button onClick={load} className="rounded-xl border bg-white px-3 py-2 text-xs">
              Refresh
            </button>
          </div>

          {filteredMeetings.length === 0 ? (
            <div className="mt-4 text-sm text-black/70">No meetings found.</div>
          ) : (
            <div className="mt-4 space-y-3">
              {filteredMeetings.map((m) => {
                const bookedName = profilesById[m.booked_by_id]?.full_name ?? "—";
                const takenName = profilesById[m.attended_by_id]?.full_name ?? "—";

                return (
                  <div
                    key={m.id}
                    className={`rounded-2xl border p-4 ${m.is_closed ? "bg-green-50 border-green-200" : "bg-white"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-9 w-9 rounded-xl border bg-gray-50 flex items-center justify-center text-xs font-semibold">
                          {initials(m.meeting_name)}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold truncate">{m.meeting_name || "Unnamed meeting"}</div>
                          <div className="mt-1 text-xs text-black/60">{fmtDateTimeAU(m.meeting_at)}</div>
                          <div className="mt-1 text-xs text-black/60">
                            Booked: <span className="font-medium text-black">{bookedName}</span> • Taken:{" "}
                            <span className="font-medium text-black">{takenName}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => discardMeeting(m.id)}
                          disabled={savingMeetingId === m.id}
                          className="rounded-xl border px-3 py-2 text-xs bg-white text-black disabled:opacity-60"
                          title="Hide this meeting (keeps data for KPIs)"
                        >
                          Discard
                        </button>

                        <button
                          onClick={() => saveMeetingUpdates(m)}
                          disabled={savingMeetingId === m.id}
                          className="rounded-xl bg-black px-3 py-2 text-xs text-white disabled:opacity-60"
                        >
                          {savingMeetingId === m.id ? "Saving…" : "Save"}
                        </button>
                      </div>
                    </div>

                    {/* Quick edits */}
                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <div className="lg:col-span-2">
                        <label className="text-xs font-medium text-black">Meeting name</label>
                        <input
                          className="mt-1 w-full rounded-xl border px-3 py-2 text-sm text-black"
                          value={m.meeting_name ?? ""}
                          onChange={(e) => patchMeeting(m.id, { meeting_name: e.target.value })}
                        />
                      </div>

                      <div>
                        <label className="text-xs font-medium text-black">Booked by</label>
                        <select
                          className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white text-black"
                          value={m.booked_by_id}
                          onChange={(e) =>
                            patchMeeting(m.id, {
                              booked_by_id: e.target.value,
                              booked_calendar_user_id: e.target.value,
                            })
                          }
                        >
                          {profiles.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.full_name ?? p.id}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-medium text-black">Taken by</label>
                        <select
                          className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white text-black"
                          value={m.attended_by_id}
                          onChange={(e) => patchMeeting(m.id, { attended_by_id: e.target.value })}
                        >
                          {profiles.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.full_name ?? p.id}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-medium text-black">Lead score</label>
                        <select
                          className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-white text-black"
                          value={String(m.lead_score)}
                          onChange={(e) => patchMeeting(m.id, { lead_score: Number(e.target.value) })}
                        >
                          <option value="1">1 (Cold)</option>
                          <option value="2">2 (Warm)</option>
                          <option value="3">3 (Hot)</option>
                        </select>
                      </div>

                      <div className="sm:col-span-2 lg:col-span-3">
                        <label className="text-xs font-medium text-black">Outcomes</label>
                        <div className="mt-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <label className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm bg-white">
                            <span className="text-black">Showed up</span>
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={m.showed_up}
                              onChange={(e) => patchMeeting(m.id, { showed_up: e.target.checked })}
                            />
                          </label>

                          <label className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm bg-white">
                            <span className="text-black">Moved to SS2</span>
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={m.moved_to_ss2}
                              onChange={(e) => patchMeeting(m.id, { moved_to_ss2: e.target.checked })}
                            />
                          </label>

                          <label className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm bg-white">
                            <span className="text-black">Closed</span>
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={m.is_closed}
                              onChange={(e) =>
                                patchMeeting(m.id, {
                                  is_closed: e.target.checked,
                                  closed_at: e.target.checked ? (m.closed_at ?? new Date().toISOString()) : null,
                                })
                              }
                            />
                          </label>
                        </div>
                      </div>

                      <div className="flex items-end">
                        <div className="text-[11px] text-black/50">
                          {m.is_closed ? "Closed ✅" : m.lead_score === 3 ? "Hot lead 🔥" : "—"}
                        </div>
                      </div>
                    </div>

                    {m.closed_at && m.is_closed ? (
                      <div className="mt-2 text-[11px] text-black/50">Closed at: {fmtDateTimeAU(m.closed_at)}</div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {msg && <div className="mt-6 rounded-xl border bg-gray-50 p-3 text-sm text-black">{msg}</div>}
      </div>
    </div>
  );
}