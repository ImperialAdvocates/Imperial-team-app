"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type FieldRow = {
  id: string;
  key: string;
  label: string | null;
  active: boolean;
  sort_order: number | null;
  input_type: string | null;
};

type SubmissionRow = {
  id: string;
  user_id: string;
  entry_date: string; // YYYY-MM-DD
};

function toISODateMelb(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d);
}

export default function KpiEntryPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pageMsg, setPageMsg] = useState<string | null>(null);

  const [userId, setUserId] = useState<string>("");
  const [fields, setFields] = useState<FieldRow[]>([]);
  const [submission, setSubmission] = useState<SubmissionRow | null>(null);
  const [valuesByFieldId, setValuesByFieldId] = useState<Record<string, string>>({});

  const todayISO = useMemo(() => toISODateMelb(new Date()), []);

  useEffect(() => {
    async function init() {
      setPageMsg(null);

      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;

      if (!session) {
        router.push("/login");
        return;
      }

      setUserId(session.user.id);

      const { data: fieldRows, error: fErr } = await supabase
        .from("kpi_fields")
        .select("id, key, label, active, sort_order, input_type")
        .eq("active", true)
        .order("sort_order", { ascending: true })
        .order("label", { ascending: true });

      if (fErr) {
        setPageMsg(fErr.message);
        setLoading(false);
        return;
      }

      const activeFields = (fieldRows ?? []) as FieldRow[];
      setFields(activeFields);

      const { data: subRow, error: sErr } = await supabase
        .from("kpi_daily_submissions")
        .select("id, user_id, entry_date")
        .eq("user_id", session.user.id)
        .eq("entry_date", todayISO)
        .maybeSingle();

      if (sErr) {
        setPageMsg(sErr.message);
        setLoading(false);
        return;
      }

      if (subRow) {
        const sub = subRow as SubmissionRow;
        setSubmission(sub);

        const { data: valRows, error: vErr } = await supabase
          .from("kpi_daily_values")
          .select("field_id, value_text")
          .eq("submission_id", sub.id);

        if (vErr) {
          setPageMsg(vErr.message);
          setLoading(false);
          return;
        }

        const next: Record<string, string> = {};
        (valRows ?? []).forEach((v: any) => {
          next[v.field_id] = v.value_text ?? "";
        });

        activeFields.forEach((f) => {
          if (next[f.id] === undefined) next[f.id] = "";
        });

        setValuesByFieldId(next);
      } else {
        const next: Record<string, string> = {};
        activeFields.forEach((f) => (next[f.id] = ""));
        setValuesByFieldId(next);
      }

      setLoading(false);
    }

    init();
  }, [router, todayISO]);

  function setValue(fieldId: string, val: string) {
    setValuesByFieldId((prev) => ({ ...prev, [fieldId]: val }));
  }

  function isNumericOrEmpty(s: string) {
    if (s.trim() === "") return true;
    return /^-?\d+(\.\d+)?$/.test(s.trim());
  }

  async function handleSave() {
    setPageMsg(null);

    for (const f of fields) {
      const raw = valuesByFieldId[f.id] ?? "";
      if (!isNumericOrEmpty(raw)) {
        setPageMsg(`"${f.label ?? f.key}" must be a number.`);
        return;
      }
    }

    setSaving(true);

    try {
      // ✅ Always fetch session here (don’t rely on userId state)
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;
      if (!session) {
        router.push("/login");
        return;
      }
      const uid = session.user.id;

      const { data: subUpsert, error: subErr } = await supabase
        .from("kpi_daily_submissions")
        .upsert(
          { user_id: uid, entry_date: todayISO },
          { onConflict: "user_id,entry_date", ignoreDuplicates: false }
        )
        .select("id, user_id, entry_date")
        .single();

      if (subErr) throw new Error(subErr.message);

      const sub = subUpsert as SubmissionRow;
      setSubmission(sub);

      const payload = fields.map((f) => ({
        submission_id: sub.id,
        field_id: f.id,
        value_text: (valuesByFieldId[f.id] ?? "").trim(),
      }));

      const { error: valErr } = await supabase
        .from("kpi_daily_values")
        .upsert(payload, { onConflict: "submission_id,field_id" });

      if (valErr) throw new Error(valErr.message);

      setPageMsg("Saved ✅");
      setTimeout(() => setPageMsg(null), 1500);
    } catch (e: any) {
      setPageMsg(e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-6">Loading…</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-start justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-semibold">Daily KPI Entry</h1>
            <div className="mt-1 text-xs text-gray-500">
              Date (Melbourne): <span className="font-medium">{todayISO}</span>
              {submission ? (
                <span className="ml-2">• Status: Saved</span>
              ) : (
                <span className="ml-2">• Status: Not submitted</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push("/hub")}
              className="rounded-xl border px-4 py-2 text-sm bg-white"
            >
              Back
            </button>

            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-xl border px-4 py-2 text-sm bg-gray-900 text-white disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-5">
          {fields.length === 0 ? (
            <div className="text-sm text-gray-600">No KPI fields configured.</div>
          ) : (
            <div className="space-y-3">
              {fields.map((f) => (
                <div key={f.id} className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{f.label ?? f.key}</div>
                    <div className="text-xs text-gray-500">{f.key}</div>
                  </div>

                  <input
                    inputMode="numeric"
                    className="w-40 rounded-xl border px-3 py-2 text-sm bg-white"
                    placeholder="0"
                    value={valuesByFieldId[f.id] ?? ""}
                    onChange={(e) => setValue(f.id, e.target.value)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {pageMsg && (
          <div className="mt-4 rounded-xl border bg-gray-50 p-3 text-sm text-gray-700">
            {pageMsg}
          </div>
        )}
      </div>
    </div>
  );
}