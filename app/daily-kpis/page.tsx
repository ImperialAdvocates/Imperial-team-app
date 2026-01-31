"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type DailyKpiRow = {
  id: string;
  user_id: string;
  entry_date: string; // YYYY-MM-DD
  appointments_booked: number;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  role: string | null;
  is_admin: boolean | null;
};

function melbourneDateISO(d: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function safeNum(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

export default function DailyKpisPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [userId, setUserId] = useState<string>("");
  const [name, setName] = useState<string>("Team member");

  const [days, setDays] = useState<string[]>([]);
  const [selectedDay, setSelectedDay] = useState<string>(() => melbourneDateISO(new Date()));

  const [appointmentsBooked, setAppointmentsBooked] = useState<string>("0");
  const [notes, setNotes] = useState<string>("");

  const buildHistory = useCallback(() => {
    const out: string[] = [];
    const base = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() - i);
      out.push(melbourneDateISO(d));
    }
    setDays(out);
  }, []);

  const ensureSessionAndProfile = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session) {
      router.push("/login");
      return null;
    }

    const uid = session.user.id;
    setUserId(uid);

    const { data: prof, error } = await supabase
      .from("profiles")
      .select("id, full_name, role, is_admin")
      .eq("id", uid)
      .single();

    if (error) throw new Error(error.message);

    const p = prof as ProfileRow;
    setName(p.full_name ?? "Team member");
    return { uid };
  }, [router]);

  const loadDay = useCallback(
    async (uid: string, dayISO: string) => {
      const { data, error } = await supabase
        .from("daily_kpis")
        .select("id, user_id, entry_date, appointments_booked, notes")
        .eq("user_id", uid)
        .eq("entry_date", dayISO)
        .maybeSingle();

      if (error) throw new Error(error.message);

      if (!data) {
        setAppointmentsBooked("0");
        setNotes("");
        return;
      }

      const row = data as DailyKpiRow;
      setAppointmentsBooked(String(safeNum(row.appointments_booked)));
      setNotes(row.notes ?? "");
    },
    []
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    setMsg(null);

    try {
      buildHistory();

      const sessionInfo = await ensureSessionAndProfile();
      if (!sessionInfo) return;

      await loadDay(sessionInfo.uid, selectedDay);

      setLoading(false);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to load Daily KPIs.");
      setLoading(false);
    }
  }, [buildHistory, ensureSessionAndProfile, loadDay, selectedDay]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Reload KPI values when user clicks a different day
  useEffect(() => {
    if (!userId) return;
    loadDay(userId, selectedDay).catch((e) => setMsg(e?.message ?? "Failed to load day."));
  }, [selectedDay, userId, loadDay]);

  const save = useCallback(async () => {
    if (!userId) return;

    setSaving(true);
    setMsg(null);

    try {
      const appt = safeNum(appointmentsBooked);

      const payload = {
        user_id: userId,
        entry_date: selectedDay,
        appointments_booked: appt,
        notes: notes.trim() ? notes.trim() : null,
      };

      const { error } = await supabase
        .from("daily_kpis")
        .upsert(payload, { onConflict: "user_id,entry_date" });

      if (error) throw new Error(error.message);

      setMsg("Saved ✅");
      setTimeout(() => setMsg(null), 1200);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to save.");
    } finally {
      setSaving(false);
    }
  }, [userId, selectedDay, appointmentsBooked, notes]);

  if (loading) return <div className="p-6 text-black">Loading…</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-6 text-black">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-xs text-black/60">Daily KPIs</div>
            <h1 className="text-2xl font-semibold">{name}</h1>
            <div className="mt-1 text-xs text-black/60">
              Date: <span className="font-medium text-black">{selectedDay}</span>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => router.push("/hub")}
              className="rounded-xl border px-4 py-2 text-sm bg-white text-black"
            >
              Back
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="rounded-xl bg-black px-4 py-2 text-sm text-white disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[240px_1fr]">
          {/* History */}
          <div className="rounded-2xl border bg-white p-4">
            <div className="text-sm font-medium mb-3">History</div>
            <div className="space-y-2">
              {days.map((d) => {
                const isSel = d === selectedDay;
                return (
                  <button
                    key={d}
                    onClick={() => setSelectedDay(d)}
                    className={`w-full rounded-xl border px-3 py-2 text-left text-sm ${
                      isSel ? "bg-black text-white" : "bg-white text-black"
                    }`}
                  >
                    {d === melbourneDateISO(new Date()) ? "Today" : d}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Form */}
          <div className="rounded-2xl border bg-white p-5">
            <div className="text-sm font-medium">KPIs to log</div>
            <div className="text-xs text-black/60 mt-1">
              Keep it simple: just appointments booked (+ optional notes).
            </div>

            <div className="mt-4 grid gap-3">
              <label className="text-xs text-black/60">
                Appointments booked
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  inputMode="numeric"
                  value={appointmentsBooked}
                  onChange={(e) => setAppointmentsBooked(e.target.value)}
                  placeholder="0"
                />
              </label>

              <label className="text-xs text-black/60">
                Notes (optional)
                <textarea
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  placeholder="Anything worth noting for the day…"
                />
              </label>
            </div>

            {msg && <div className="mt-4 rounded-xl border bg-gray-50 p-3 text-sm">{msg}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}