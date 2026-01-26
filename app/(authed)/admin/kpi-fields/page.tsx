"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type InputType = "number" | "text";

type FieldRow = {
  id: string;
  key: string;
  label: string | null;
  active: boolean;
  sort_order: number | null;
  input_type: InputType | null;
};

export default function AdminKpiFieldsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pageMsg, setPageMsg] = useState<string | null>(null);

  const [fields, setFields] = useState<FieldRow[]>([]);
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newSort, setNewSort] = useState<number>(100);
  const [newInputType, setNewInputType] = useState<InputType>("number");

  async function requireAdmin() {
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session) {
      router.push("/login");
      return false;
    }

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("role, is_admin")
      .eq("id", session.user.id)
      .single();

    if (error) {
      setPageMsg(error.message);
      return false;
    }

    const okAdmin = profile?.role === "admin" || !!profile?.is_admin;
    if (!okAdmin) {
      router.push("/hub");
      return false;
    }

    return true;
  }

  async function loadFields() {
    setPageMsg(null);
    const { data, error } = await supabase
      .from("kpi_fields")
      .select("id, key, label, active, sort_order, input_type")
      .order("sort_order", { ascending: true })
      .order("key", { ascending: true });

    if (error) {
      setPageMsg(error.message);
      return;
    }
    setFields((data ?? []) as FieldRow[]);
  }

  useEffect(() => {
    async function init() {
      const ok = await requireAdmin();
      if (!ok) return;
      await loadFields();
      setLoading(false);
    }
    init();
  }, [router]);

  function updateField(id: string, patch: Partial<FieldRow>) {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  async function saveAll() {
    setSaving(true);
    setPageMsg(null);

    try {
      const payload = fields.map((f) => ({
        id: f.id,
        label: f.label,
        active: f.active,
        sort_order: f.sort_order ?? 100,
        input_type: (f.input_type ?? "number") as InputType,
      }));

      const { error } = await supabase.from("kpi_fields").upsert(payload, {
        onConflict: "id",
      });

      if (error) throw new Error(error.message);

      setPageMsg("Saved ✅");
      setTimeout(() => setPageMsg(null), 1500);
      await loadFields();
    } catch (e: any) {
      setPageMsg(e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function addField() {
    setPageMsg(null);

    const key = newKey.trim().toLowerCase().replace(/\s+/g, "_");
    if (!key) {
      setPageMsg("Key is required.");
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from("kpi_fields").insert({
        key,
        label: newLabel.trim() || key,
        active: true,
        sort_order: Number.isFinite(newSort) ? newSort : 100,
        input_type: newInputType,
      });

      if (error) throw new Error(error.message);

      setNewKey("");
      setNewLabel("");
      setNewSort(100);
      setNewInputType("number");

      await loadFields();
      setPageMsg("Field added ✅");
      setTimeout(() => setPageMsg(null), 1500);
    } catch (e: any) {
      setPageMsg(e?.message ?? "Failed to add field");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-6">Loading…</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Admin — KPI Fields</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push("/hub")}
              className="rounded-xl border px-4 py-2 text-sm bg-white"
            >
              Back
            </button>
            <button
              onClick={saveAll}
              disabled={saving}
              className="rounded-xl border px-4 py-2 text-sm bg-gray-900 text-white disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-5 mb-6">
          <div className="text-sm font-medium mb-3">Add KPI field</div>
          <div className="grid gap-3 md:grid-cols-5">
            <input
              className="rounded-xl border px-3 py-2 text-sm"
              placeholder="key (e.g. dials)"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
            />
            <input
              className="rounded-xl border px-3 py-2 text-sm"
              placeholder="label (e.g. Dials)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
            />
            <input
              className="rounded-xl border px-3 py-2 text-sm"
              placeholder="sort order"
              type="number"
              value={newSort}
              onChange={(e) => setNewSort(Number(e.target.value))}
            />
            <select
              className="rounded-xl border px-3 py-2 text-sm bg-white"
              value={newInputType}
              onChange={(e) => setNewInputType(e.target.value as InputType)}
            >
              <option value="number">number</option>
              <option value="text">text</option>
            </select>
            <button
              onClick={addField}
              disabled={saving}
              className="rounded-xl border px-4 py-2 text-sm bg-white hover:bg-gray-50 disabled:opacity-60"
            >
              Add
            </button>
          </div>
          <div className="text-xs text-gray-500 mt-2">
            Keys are auto-normalised to snake_case.
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-5">
          <div className="text-sm font-medium mb-4">Fields</div>

          {fields.length === 0 ? (
            <div className="text-sm text-gray-600">No fields yet.</div>
          ) : (
            <div className="space-y-3">
              {fields.map((f) => (
                <div
                  key={f.id}
                  className="rounded-xl border p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{f.key}</div>
                    <div className="text-xs text-gray-500">id: {f.id}</div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      className="w-56 rounded-xl border px-3 py-2 text-sm"
                      placeholder="Label"
                      value={f.label ?? ""}
                      onChange={(e) => updateField(f.id, { label: e.target.value })}
                    />

                    <input
                      className="w-28 rounded-xl border px-3 py-2 text-sm"
                      type="number"
                      value={f.sort_order ?? 100}
                      onChange={(e) =>
                        updateField(f.id, { sort_order: Number(e.target.value) })
                      }
                    />

                    <select
                      className="w-28 rounded-xl border px-3 py-2 text-sm bg-white"
                      value={(f.input_type ?? "number") as InputType}
                      onChange={(e) =>
                        updateField(f.id, { input_type: e.target.value as InputType })
                      }
                    >
                      <option value="number">number</option>
                      <option value="text">text</option>
                    </select>

                    <button
                      onClick={() => updateField(f.id, { active: !f.active })}
                      className={`rounded-full border px-3 py-1 text-sm ${
                        f.active ? "bg-green-50" : "bg-red-50"
                      }`}
                    >
                      {f.active ? "Active" : "Inactive"}
                    </button>
                  </div>
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