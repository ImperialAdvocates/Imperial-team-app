"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type KPIField = {
  id: string;
  key: string;
  label: string;
  field_type: "number" | "text" | "select";
  target_min: number | null;
  target_good: number | null;
  sort_order: number;
};

function melbourneTodayISO(): string {
  // Returns YYYY-MM-DD in Australia/Melbourne time
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date()); // en-CA gives YYYY-MM-DD
}

export default function KpiTodayPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  const today = useMemo(() => melbourneTodayISO(), []);

  const [templateId, setTemplateId] = useState<string | null>(null);
  const [fields, setFields] = useState<KPIField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({}); // fieldId -> value
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setMessage(null);

      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;

      if (!session) {
        router.push("/login");
        return;
      }

      setUserId(session.user.id);

      // For MVP: just pick the first template in the DB.
      const { data: templates, error: tplErr } = await supabase
        .from("kpi_templates")
        .select("id")
        .limit(1);

      if (tplErr || !templates || templates.length === 0) {
        setMessage("No KPI template found. Ask an admin to create one in Supabase.");
        setLoading(false);
        return;
      }

      const tplId = templates[0].id as string;
      setTemplateId(tplId);

      // Load fields
      const { data: flds, error: fieldsErr } = await supabase
        .from("kpi_fields")
        .select("id,key,label,field_type,target_min,target_good,sort_order")
        .eq("template_id", tplId)
        .order("sort_order", { ascending: true });

      if (fieldsErr || !flds) {
        setMessage(fieldsErr?.message ?? "Failed to load KPI fields.");
        setLoading(false);
        return;
      }

      setFields(flds as KPIField[]);

      // Check if already submitted today
      const { data: existing, error: existingErr } = await supabase
        .from("kpi_daily_submissions")
        .select("id")
        .eq("user_id", session.user.id)
        .eq("entry_date", today)
        .maybeSingle();

      if (existingErr) {
        setMessage(existingErr.message);
        setLoading(false);
        return;
      }

      if (existing?.id) {
        setSubmitted(true);
      }

      setLoading(false);
    }

    load();
  }, [router, today]);

  async function submit() {
    if (!userId || !templateId) return;
    setMessage(null);

    // Basic validation: require all fields to have something (except optional text could be empty if you want)
    for (const f of fields) {
      if (f.field_type !== "text") {
        if (!values[f.id] || values[f.id].trim() === "") {
          setMessage(`Please fill: ${f.label}`);
          return;
        }
      }
    }

    // Create submission (unique constraint prevents duplicates)
    const { data: submission, error: subErr } = await supabase
      .from("kpi_daily_submissions")
      .insert({
        user_id: userId,
        template_id: templateId,
        entry_date: today,
      })
      .select("id")
      .single();

    if (subErr) {
      // If they already submitted, show a friendly message
      if (subErr.message.toLowerCase().includes("duplicate")) {
        setSubmitted(true);
        setMessage("You’ve already submitted today ✅");
        return;
      }
      setMessage(subErr.message);
      return;
    }

    // Insert values
    const rows = fields.map((f) => ({
      submission_id: submission.id,
      field_id: f.id,
      value_text: values[f.id] ?? "",
    }));

    const { error: valsErr } = await supabase.from("kpi_daily_values").insert(rows);

    if (valsErr) {
      setMessage(valsErr.message);
      return;
    }

    setSubmitted(true);
    setMessage("Submitted ✅");
  }

  if (loading) return <div className="p-6">Loading…</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Daily KPI</h1>
          <button
            onClick={() => router.push("/hub")}
            className="rounded-xl border px-4 py-2 text-sm bg-white"
          >
            Back
          </button>
        </div>

        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="mb-4 text-sm text-gray-600">
            Date (Melbourne): <span className="font-medium text-gray-900">{today}</span>
          </div>

          {submitted ? (
            <div className="rounded-xl border bg-green-50 p-4 text-sm">
              You’ve submitted today’s KPI ✅
            </div>
          ) : (
            <div className="space-y-4">
              {fields.map((f) => (
                <div key={f.id}>
                  <label className="text-sm font-medium">{f.label}</label>
                  {f.field_type === "text" ? (
                    <textarea
                      className="mt-1 w-full rounded-xl border px-3 py-2"
                      rows={3}
                      value={values[f.id] ?? ""}
                      onChange={(e) =>
                        setValues((prev) => ({ ...prev, [f.id]: e.target.value }))
                      }
                      placeholder="Type here…"
                    />
                  ) : (
                    <input
                      className="mt-1 w-full rounded-xl border px-3 py-2"
                      value={values[f.id] ?? ""}
                      onChange={(e) =>
                        setValues((prev) => ({ ...prev, [f.id]: e.target.value }))
                      }
                      type="number"
                      placeholder="0"
                    />
                  )}
                  {(f.target_min != null || f.target_good != null) && (
                    <div className="mt-1 text-xs text-gray-500">
                      Targets: min {f.target_min ?? "-"}, good {f.target_good ?? "-"}
                    </div>
                  )}
                </div>
              ))}

              <button
                onClick={submit}
                className="w-full rounded-xl bg-gray-900 px-4 py-2 text-white"
              >
                Submit KPI
              </button>
            </div>
          )}

          {message && (
            <div className="mt-4 rounded-xl border bg-gray-50 p-3 text-sm text-gray-700">
              {message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}