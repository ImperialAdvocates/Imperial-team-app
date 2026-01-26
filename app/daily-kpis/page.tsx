"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

/**
 * Daily KPIs (Setter metrics) — editable for EVERYONE.
 * We only show:
 *  - dials
 *  - conversations
 *  - appointments_booked OR appointments_set
 */

type ProfileRow = {
  full_name: string | null;
  role: string | null;
  primary_role: string | null;
  is_admin: boolean | null;
};

type TemplateRow = {
  id: string;
  name: string;
  role: string;
  active: boolean;
};

type FieldDef = {
  id: string;
  key: string;
  label: string | null;
  input_type: "number" | "text";
  active: boolean;
};

type TemplateFieldRow = {
  id: string;
  template_id: string;
  field_id: string;
  sort_order: number;
  active: boolean;
  target_min: number | null;
  target_good: number | null;
  field: FieldDef | null;
};

type SubmissionRow = {
  id: string;
  user_id: string;
  entry_date: string; // YYYY-MM-DD
  template_id: string | null;
};

function melbourneDateISO(d: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** ✅ Allow either naming convention */
const ALLOWED_KEYS = new Set<string>([
  "dials",
  "conversations",
  "appointments_booked",
  "appointments_set",
]);

/* ---------------- KPI Helpers ---------------- */

function toNumberOrNull(s: string): number | null {
  const raw = (s ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

type KpiUI = {
  label: string;
  pillClass: string;
  cardClass: string;
  barClass: string;
};

function kpiStatusUI(input: string, targetMin: number | null, targetGood: number | null): KpiUI {
  const n = toNumberOrNull(input);

  if (n === null) {
    return {
      label: "—",
      pillClass: "bg-white text-black border-gray-200",
      cardClass: "border-gray-200",
      barClass: "bg-gray-400",
    };
  }

  if (targetMin !== null && n < targetMin) {
    return {
      label: "Below min",
      pillClass: "bg-red-50 text-red-700 border-red-200",
      cardClass: "border-red-200 bg-red-50/30",
      barClass: "bg-red-600",
    };
  }

  if (targetGood !== null && n >= targetGood) {
    return {
      label: "Good",
      pillClass: "bg-green-50 text-green-700 border-green-200",
      cardClass: "border-green-200 bg-green-50/30",
      barClass: "bg-green-600",
    };
  }

  if (targetMin !== null || targetGood !== null) {
    return {
      label: "On track",
      pillClass: "bg-amber-50 text-amber-800 border-amber-200",
      cardClass: "border-amber-200 bg-amber-50/20",
      barClass: "bg-amber-600",
    };
  }

  return {
    label: "Logged",
    pillClass: "bg-white text-black border-gray-200",
    cardClass: "border-gray-200",
    barClass: "bg-gray-600",
  };
}

function kpiProgress(input: string, targetMin: number | null, targetGood: number | null) {
  if (targetGood === null) return { show: false, percent: 0, leftLabel: "", rightLabel: "" };

  const start = targetMin !== null ? targetMin : 0;
  const end = targetGood;

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return { show: false, percent: 0, leftLabel: "", rightLabel: "" };
  }

  const n = toNumberOrNull(input);
  const value = n === null ? start : n;

  const clamped = Math.min(Math.max(value, start), end);
  const percent = Math.round(((clamped - start) / (end - start)) * 100);

  return { show: true, percent, leftLabel: String(start), rightLabel: String(end) };
}

function isNumericOrEmpty(s: string) {
  if (s.trim() === "") return true;
  return /^-?\d+(\.\d+)?$/.test(s.trim());
}

/* ---------------------------------------------------- */

export default function DailyKpisPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [name, setName] = useState<string>("Team member");

  const [days, setDays] = useState<string[]>([]);
  const [selectedDay, setSelectedDay] = useState<string>(() => melbourneDateISO(new Date()));

  const [userId, setUserId] = useState<string>("");

  const [template, setTemplate] = useState<TemplateRow | null>(null);
  const [tFields, setTFields] = useState<TemplateFieldRow[]>([]);

  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

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

    const { data: prof, error: pErr } = await supabase
      .from("profiles")
      .select("full_name, role, primary_role, is_admin")
      .eq("id", uid)
      .single();

    if (pErr) throw new Error(pErr.message);

    const p = prof as ProfileRow;
    setName(p.full_name ?? "Team member");

    return { uid };
  }, [router]);

  const loadSetterTemplate = useCallback(async () => {
    const { data: tData, error: tErr } = await supabase
      .from("kpi_templates")
      .select("id, name, role, active")
      .eq("role", "setter")
      .eq("active", true)
      .limit(1);

    if (tErr) throw new Error(tErr.message);

    const t = (tData?.[0] ?? null) as TemplateRow | null;
    if (!t) throw new Error("No ACTIVE KPI template found for role 'setter'.");

    setTemplate(t);
    return t;
  }, []);

  const loadSetterTemplateFields = useCallback(async (templateId: string) => {
    const { data, error } = await supabase
      .from("kpi_template_fields")
      .select(
        `
        id,
        template_id,
        field_id,
        sort_order,
        active,
        target_min,
        target_good,
        field:kpi_fields (
          id,
          key,
          label,
          input_type,
          active
        )
      `
      )
      .eq("template_id", templateId)
      .eq("active", true)
      .order("sort_order", { ascending: true });

    if (error) throw new Error(error.message);

    const rows = (data ?? []) as any[];
    const parsed: TemplateFieldRow[] = rows.map((r) => ({
      id: r.id,
      template_id: r.template_id,
      field_id: r.field_id,
      sort_order: r.sort_order ?? 100,
      active: !!r.active,
      target_min: r.target_min ?? null,
      target_good: r.target_good ?? null,
      field: r.field
        ? {
            id: r.field.id,
            key: String(r.field.key ?? "").trim().toLowerCase(),
            label: r.field.label,
            input_type: (r.field.input_type ?? "number") as "number" | "text",
            active: !!r.field.active,
          }
        : null,
    }));

    const filtered = parsed.filter((x) => x.field?.active && x.field?.key && ALLOWED_KEYS.has(x.field.key));
    setTFields(filtered);
    return filtered;
  }, []);

  const ensureSubmission = useCallback(async (uid: string, templateId: string, dayISO: string) => {
    const { data: subUpsert, error: subErr } = await supabase
      .from("kpi_daily_submissions")
      .upsert({ user_id: uid, entry_date: dayISO, template_id: templateId }, { onConflict: "user_id,entry_date" })
      .select("id,user_id,entry_date,template_id")
      .single();

    if (subErr) throw new Error(subErr.message);

    setSubmissionId(subUpsert.id);
    return subUpsert as SubmissionRow;
  }, []);

  const loadValuesIntoDraft = useCallback(async (subId: string, fieldRows: TemplateFieldRow[]) => {
    const { data, error } = await supabase
      .from("kpi_daily_values")
      .select("field_id, value_text")
      .eq("submission_id", subId);

    if (error) throw new Error(error.message);

    const map: Record<string, string> = {};
    (data ?? []).forEach((r: any) => {
      map[String(r.field_id)] = String(r.value_text ?? "");
    });

    const d: Record<string, string> = {};
    fieldRows.forEach((tf) => {
      d[tf.field_id] = map[tf.field_id] ?? "";
    });

    setDraft(d);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setMsg(null);

    try {
      buildHistory();

      const sessionInfo = await ensureSessionAndProfile();
      if (!sessionInfo) return;

      const { uid } = sessionInfo;

      const t = await loadSetterTemplate();
      const fields = await loadSetterTemplateFields(t.id);

      const sub = await ensureSubmission(uid, t.id, selectedDay);
      await loadValuesIntoDraft(sub.id, fields);

      setLoading(false);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to load Daily KPIs.");
      setLoading(false);
    }
  }, [buildHistory, ensureSessionAndProfile, loadSetterTemplate, loadSetterTemplateFields, ensureSubmission, loadValuesIntoDraft, selectedDay]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const save = useCallback(async () => {
    if (!template || !submissionId) return;

    setSaving(true);
    setMsg(null);

    try {
      for (const tf of tFields) {
        if ((tf.field?.input_type ?? "number") === "number") {
          const raw = draft[tf.field_id] ?? "";
          if (!isNumericOrEmpty(raw)) {
            setMsg(`"${tf.field?.label ?? tf.field?.key ?? "KPI"}" must be a number.`);
            setSaving(false);
            return;
          }
        }
      }

      const upserts = tFields.map((tf) => ({
        submission_id: submissionId,
        field_id: tf.field_id,
        value_text: (draft[tf.field_id] ?? "").trim(),
      }));

      const { error } = await supabase.from("kpi_daily_values").upsert(upserts, {
        onConflict: "submission_id,field_id",
      });

      if (error) throw new Error(error.message);

      setMsg("Saved ✅");
      setTimeout(() => setMsg(null), 1200);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to save.");
    } finally {
      setSaving(false);
    }
  }, [template, submissionId, tFields, draft]);

  if (loading) return <div className="p-6 text-black">Loading…</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-6 text-black">
      <div className="mx-auto max-w-6xl text-black">
        <div className="flex items-center justify-between mb-6">
          <div className="text-black">
            <div className="text-xs text-black/60">Daily KPIs (Activity)</div>
            <h1 className="text-2xl font-semibold text-black">{name}</h1>
            <div className="mt-1 text-xs text-black/60">
              Date: <span className="font-medium text-black">{selectedDay}</span>
              {template ? (
                <>
                  {" "}
                  • Template: <span className="font-medium text-black">{template.name}</span>
                </>
              ) : null}
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
              disabled={saving || !template || !submissionId}
              className="rounded-xl bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[260px_1fr]">
          <div className="rounded-2xl border bg-white p-4 text-black">
            <div className="text-sm font-medium mb-3 text-black">History</div>
            <div className="space-y-2">
              {days.map((d) => {
                const isSel = d === selectedDay;
                return (
                  <button
                    key={d}
                    onClick={() => setSelectedDay(d)}
                    className={`w-full rounded-xl border px-3 py-2 text-left text-sm ${
                      isSel ? "bg-gray-900 text-white" : "bg-white text-black"
                    }`}
                  >
                    {d === melbourneDateISO(new Date()) ? "Today" : d}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-5 text-black">
            <div className="text-sm font-medium text-black">KPIs to log</div>
            <div className="text-xs text-black/60 mt-1">
              Dials • Conversations • Booked meetings
            </div>

            {tFields.length === 0 ? (
              <div className="mt-4 text-sm text-black/70">
                No fields found for this page.
                <div className="mt-2 text-xs text-black/60">
                  Make sure your ACTIVE setter template includes:
                  <span className="font-medium"> dials, conversations, appointments_booked (or appointments_set)</span>
                </div>
              </div>
            ) : (
              <div className="mt-5 grid gap-3">
                {tFields.map((tf) => {
                  const f = tf.field;
                  if (!f) return null;

                  const label = f.label ?? f.key;
                  const val = draft[tf.field_id] ?? "";

                  const ui =
                    f.input_type === "number"
                      ? kpiStatusUI(val, tf.target_min ?? null, tf.target_good ?? null)
                      : {
                          label: "—",
                          pillClass: "bg-white text-black border-gray-200",
                          cardClass: "border-gray-200",
                          barClass: "bg-gray-400",
                        };

                  const prog =
                    f.input_type === "number"
                      ? kpiProgress(val, tf.target_min ?? null, tf.target_good ?? null)
                      : { show: false, percent: 0, leftLabel: "", rightLabel: "" };

                  return (
                    <div key={tf.id} className={`rounded-xl border p-4 text-black ${ui.cardClass}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-black">{label}</div>
                          <div className="text-xs text-black/60">key: {f.key}</div>
                        </div>

                        <div className="flex flex-col items-end gap-2">
                          <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs ${ui.pillClass}`}>
                            {ui.label}
                          </span>

                          <div className="text-xs text-black/60 text-right">
                            {tf.target_min !== null ? (
                              <>
                                min: <span className="font-medium text-black">{tf.target_min}</span>
                                <br />
                              </>
                            ) : null}
                            {tf.target_good !== null ? (
                              <>
                                good: <span className="font-medium text-black">{tf.target_good}</span>
                              </>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3">
                        <input
                          className="w-full rounded-xl border px-3 py-2 text-sm bg-white text-black"
                          value={val}
                          onChange={(e) =>
                            setDraft((prev) => ({
                              ...prev,
                              [tf.field_id]: e.target.value,
                            }))
                          }
                          placeholder={f.input_type === "number" ? "0" : "Type here…"}
                          inputMode={f.input_type === "number" ? "numeric" : undefined}
                        />
                      </div>

                      {f.input_type === "number" && prog.show ? (
                        <div className="mt-3">
                          <div className="flex items-center justify-between text-xs text-black/60 mb-1">
                            <span>{prog.leftLabel}</span>
                            <span>{prog.percent}%</span>
                            <span>{prog.rightLabel}</span>
                          </div>

                          <div className="h-2 w-full rounded-full bg-gray-200 overflow-hidden">
                            <div className={`h-2 rounded-full ${ui.barClass}`} style={{ width: `${prog.percent}%` }} />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}

            {msg && (
              <div className="mt-4 rounded-xl border bg-gray-50 p-3 text-sm text-black">
                {msg}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}