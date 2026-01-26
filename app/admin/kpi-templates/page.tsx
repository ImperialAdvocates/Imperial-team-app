"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Tab = "targets" | "assignments";

type ProfileRow = {
  id: string;
  full_name: string | null;
  role: string | null;
  is_admin?: boolean | null;
  kpi_template_id: string | null;
};

type TemplateRow = {
  id: string;
  name: string;
  role: string;
  active: boolean;
};

type TargetRow = {
  id: string;
  role: string;
  kpi_key: string;

  // DB stores weekly (because rest of app reads target_weekly)
  target_weekly: number;

  // UI-only: monthly target (we derive this for display & edit)
  target_monthly?: number;

  active: boolean;
  created_at?: string;
};

type FieldRow = {
  id: string;
  key: string;
  label: string | null;
  input_type: string | null;
  active: boolean;
};

const TEAM_ROLE = "setter"; // ✅ we are using setter as “team” bucket

function normRole(r?: string | null) {
  return (r ?? "").trim().toLowerCase();
}

function isAdminOk(role?: string | null, is_admin?: boolean | null) {
  return !!is_admin || normRole(role) === "admin";
}

function toSnakeCase(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .replace(/-+/g, "_");
}

/* ---------------- Business Month Helpers (26th -> 25th) ---------------- */

function businessMonthStart(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);

  if (x.getDate() >= 26) {
    x.setDate(26);
  } else {
    x.setMonth(x.getMonth() - 1);
    x.setDate(26);
  }
  return x;
}

function businessMonthEndExclusive(start: Date) {
  const x = new Date(start);
  x.setMonth(x.getMonth() + 1);
  x.setDate(26);
  x.setHours(0, 0, 0, 0);
  return x;
}

function weeksInBusinessMonth(now: Date) {
  const start = businessMonthStart(now);
  const end = businessMonthEndExclusive(start);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
  return days / 7; // e.g. 30/7 = 4.2857
}

// monthly -> weekly (stored in DB)
function weeklyFromMonthly(monthly: number, now = new Date()) {
  const w = weeksInBusinessMonth(now);
  if (!Number.isFinite(monthly) || monthly <= 0) return 0;
  // Counts: round UP so goals aren't under-set
  return Math.ceil(monthly / w);
}

// weekly -> monthly (for displaying existing rows)
function monthlyFromWeekly(weekly: number, now = new Date()) {
  const w = weeksInBusinessMonth(now);
  if (!Number.isFinite(weekly) || weekly <= 0) return 0;
  return Math.round(weekly * w);
}

export default function AdminKpiSetupPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>("targets");

  // Shared data
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [fields, setFields] = useState<FieldRow[]>([]);

  // Targets (TEAM) — UI edits monthly, DB stores weekly
  const [targets, setTargets] = useState<TargetRow[]>([]);
  const [newKey, setNewKey] = useState("");
  const [newMonthly, setNewMonthly] = useState<number>(0);

  // Assignments
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");

  const monthWeeks = useMemo(() => weeksInBusinessMonth(new Date()), []);

  const selectedUser = useMemo(
    () => profiles.find((p) => p.id === selectedUserId) ?? null,
    [profiles, selectedUserId]
  );

  const templatesForUser = useMemo(() => {
    const r = normRole(selectedUser?.role);
    if (!r) return templates;
    const a = templates.filter((t) => normRole(t.role) === r);
    const b = templates.filter((t) => normRole(t.role) !== r);
    return [...a, ...b];
  }, [templates, selectedUser]);

  const roleActiveTemplate = useMemo(() => {
    const r = normRole(selectedUser?.role);
    if (!r) return null;
    return (
      templates.find((t) => normRole(t.role) === r && t.active) ??
      templates.find((t) => normRole(t.role) === r) ??
      null
    );
  }, [templates, selectedUser]);

  const assignedTemplate = useMemo(() => {
    if (!selectedUser?.kpi_template_id) return null;
    return templates.find((t) => t.id === selectedUser.kpi_template_id) ?? null;
  }, [selectedUser, templates]);

  const effectiveTemplate = useMemo(
    () => assignedTemplate ?? roleActiveTemplate,
    [assignedTemplate, roleActiveTemplate]
  );

  const isDirtyAssign = useMemo(() => {
    if (!selectedUser) return false;
    const current = selectedUser.kpi_template_id ?? "";
    return current !== (selectedTemplateId ?? "");
  }, [selectedUser, selectedTemplateId]);

  const fieldsByKey = useMemo(() => {
    const m: Record<string, FieldRow> = {};
    fields.forEach((f) => (m[f.key] = f));
    return m;
  }, [fields]);

  const requireAdmin = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session) {
      router.push("/login");
      return false;
    }

    const meRes = await supabase
      .from("profiles")
      .select("role, is_admin")
      .eq("id", session.user.id)
      .single();

    if (meRes.error) {
      setMsg(meRes.error.message);
      return false;
    }

    if (!isAdminOk(meRes.data?.role, meRes.data?.is_admin)) {
      router.push("/hub");
      return false;
    }

    return true;
  }, [router]);

  const loadShared = useCallback(async () => {
    const [pRes, tRes, fRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, role, is_admin, kpi_template_id")
        .order("full_name", { ascending: true }),
      supabase
        .from("kpi_templates")
        .select("id, name, role, active")
        .order("role", { ascending: true })
        .order("name", { ascending: true }),
      supabase.from("kpi_fields").select("id, key, label, input_type, active").eq("active", true),
    ]);

    if (pRes.error) throw new Error(pRes.error.message);
    if (tRes.error) throw new Error(tRes.error.message);
    if (fRes.error) throw new Error(fRes.error.message);

    const profs = (pRes.data ?? []) as ProfileRow[];
    setProfiles(profs);
    setTemplates((tRes.data ?? []) as TemplateRow[]);
    setFields((fRes.data ?? []) as FieldRow[]);

    if (!selectedUserId && profs.length > 0) {
      setSelectedUserId(profs[0].id);
      setSelectedTemplateId(profs[0].kpi_template_id ?? "");
    }
  }, [selectedUserId]);

  const loadTargets = useCallback(async () => {
    const res = await supabase
      .from("kpi_targets")
      .select("id, role, kpi_key, target_weekly, active, created_at")
      .eq("role", TEAM_ROLE)
      .order("active", { ascending: false })
      .order("kpi_key", { ascending: true });

    if (res.error) throw new Error(res.error.message);

    const rows = (res.data ?? []) as TargetRow[];
    // derive monthly for UI display
    const mapped = rows.map((t) => ({
      ...t,
      target_monthly: monthlyFromWeekly(Number(t.target_weekly ?? 0) || 0),
    }));

    setTargets(mapped);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setMsg(null);

    try {
      const ok = await requireAdmin();
      if (!ok) {
        setLoading(false);
        return;
      }

      await loadShared();
      await loadTargets();

      setLoading(false);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to load KPI setup.");
      setLoading(false);
    }
  }, [requireAdmin, loadShared, loadTargets]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!selectedUserId) return;
    const u = profiles.find((x) => x.id === selectedUserId);
    setSelectedTemplateId(u?.kpi_template_id ?? "");
  }, [selectedUserId, profiles]);

  function patchTarget(id: string, patch: Partial<TargetRow>) {
    setTargets((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  async function saveTargets() {
    setSaving(true);
    setMsg(null);

    try {
      const payload = targets.map((t) => {
        const monthly = Number(t.target_monthly ?? 0) || 0;
        const weeklyAuto = weeklyFromMonthly(monthly);

        return {
          id: t.id,
          role: TEAM_ROLE,
          kpi_key: t.kpi_key,
          target_weekly: weeklyAuto, // ✅ DB stores weekly
          active: !!t.active,
        };
      });

      const { error } = await supabase.from("kpi_targets").upsert(payload, { onConflict: "id" });
      if (error) throw new Error(error.message);

      await loadTargets();
      setMsg("Saved ✅");
      setTimeout(() => setMsg(null), 1200);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to save targets.");
    } finally {
      setSaving(false);
    }
  }

  async function addTarget() {
    setSaving(true);
    setMsg(null);

    try {
      const key = toSnakeCase(newKey);
      if (!key) throw new Error("Enter a KPI key (e.g. appointments_booked).");

      const exists = targets.some((t) => t.kpi_key === key);
      if (exists) throw new Error("That KPI already exists.");

      const monthly = Number(newMonthly ?? 0) || 0;
      const weeklyAuto = weeklyFromMonthly(monthly);

      const { error } = await supabase.from("kpi_targets").insert({
        role: TEAM_ROLE,
        kpi_key: key,
        target_weekly: weeklyAuto,
        active: true,
      });

      if (error) throw new Error(error.message);

      setNewKey("");
      setNewMonthly(0);

      await loadTargets();
      setMsg("Added ✅");
      setTimeout(() => setMsg(null), 1200);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to add KPI.");
    } finally {
      setSaving(false);
    }
  }

  async function removeTarget(id: string) {
    const ok = window.confirm("Remove this KPI target?");
    if (!ok) return;

    setSaving(true);
    setMsg(null);

    try {
      const { data: deleted, error } = await supabase
        .from("kpi_targets")
        .delete()
        .eq("id", id)
        .select("id");

      if (error) throw new Error(error.message);
      if (!deleted || deleted.length === 0) throw new Error("Delete blocked (likely RLS).");

      await loadTargets();
      setMsg("Removed ✅");
      setTimeout(() => setMsg(null), 1000);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to remove KPI.");
    } finally {
      setSaving(false);
    }
  }

  async function saveAssignment() {
    if (!selectedUserId) return;

    setSaving(true);
    setMsg(null);

    try {
      const { error } = await supabase
        .from("profiles")
        .update({ kpi_template_id: selectedTemplateId || null })
        .eq("id", selectedUserId);

      if (error) throw new Error(error.message);

      setProfiles((prev) =>
        prev.map((u) =>
          u.id === selectedUserId ? { ...u, kpi_template_id: selectedTemplateId || null } : u
        )
      );

      setMsg("Assignment saved ✅");
      setTimeout(() => setMsg(null), 1200);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to save assignment.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-6 text-black">Loading…</div>;

  return (
    <div className="min-h-[100dvh] bg-gray-50 p-4 text-black">
      <div className="mx-auto w-full max-w-3xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="text-xs text-black/60">Admin</div>
            <h1 className="text-2xl font-semibold">KPI Setup</h1>
            <div className="mt-1 text-xs text-black/60">
              Set <b>MONTHLY</b> targets (26th → 25th). The app auto-calculates weekly.
            </div>
            <div className="mt-1 text-[11px] text-black/50">
              Weeks in current business month: <b>{monthWeeks.toFixed(2)}</b> • Stored in DB as{" "}
              <code>target_weekly</code>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => router.push("/admin")}
              className="rounded-xl border bg-white px-3 py-2 text-xs"
            >
              Back
            </button>
            <button
              onClick={loadAll}
              disabled={saving}
              className="rounded-xl border bg-white px-3 py-2 text-xs"
            >
              Refresh
            </button>

            {tab === "targets" ? (
              <button
                onClick={saveTargets}
                disabled={saving}
                className="rounded-xl bg-black px-3 py-2 text-xs text-white disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save targets"}
              </button>
            ) : (
              <button
                onClick={saveAssignment}
                disabled={saving || !selectedUserId || !isDirtyAssign}
                className="rounded-xl bg-black px-3 py-2 text-xs text-white disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save assignment"}
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="rounded-2xl border bg-white p-2 mb-4 flex gap-2">
          <button
            onClick={() => setTab("targets")}
            className={`flex-1 rounded-xl px-3 py-2 text-sm border ${
              tab === "targets" ? "bg-black text-white" : "bg-white text-black"
            }`}
          >
            Monthly targets
          </button>
          <button
            onClick={() => setTab("assignments")}
            className={`flex-1 rounded-xl px-3 py-2 text-sm border ${
              tab === "assignments" ? "bg-black text-white" : "bg-white text-black"
            }`}
          >
            Assign KPI form
          </button>
        </div>

        {tab === "targets" ? (
          <>
            <div className="rounded-2xl border bg-white p-4 mb-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-sm font-semibold">Mode: Team KPIs</div>
                <div className="text-[11px] text-black/50">
                  Targets saved in <code>kpi_targets</code> under role=<code>{TEAM_ROLE}</code>.
                </div>
              </div>
            </div>

            {/* Add KPI */}
            <div className="rounded-2xl border bg-white p-4 mb-4">
              <div className="text-sm font-semibold">Add KPI</div>
              <div className="mt-1 text-xs text-black/60">
                Enter <b>monthly</b>. We auto-save weekly.
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-6">
                <input
                  className="md:col-span-3 rounded-xl border px-3 py-2 text-sm"
                  placeholder="KPI key (e.g. appointments_booked)"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                />

                <input
                  className="md:col-span-2 rounded-xl border px-3 py-2 text-sm"
                  type="number"
                  value={newMonthly}
                  onChange={(e) => setNewMonthly(Number(e.target.value))}
                  placeholder="Monthly target"
                />

                <button
                  onClick={addTarget}
                  disabled={saving}
                  className="md:col-span-1 rounded-xl border bg-white px-3 py-2 text-sm disabled:opacity-60"
                >
                  Add
                </button>
              </div>

              <div className="mt-2 text-[11px] text-black/50">
                Weekly auto = <code>ceil(monthly ÷ {monthWeeks.toFixed(2)})</code>
              </div>
            </div>

            {/* Targets list */}
            <div className="rounded-2xl border bg-white p-4">
              <div className="text-sm font-semibold mb-2">Team KPIs</div>

              {targets.length === 0 ? (
                <div className="text-sm text-black/60">No KPIs yet.</div>
              ) : (
                <div className="space-y-2">
                  {targets.map((t) => {
                    const field = fieldsByKey[t.kpi_key];
                    const label = field?.label ?? t.kpi_key;

                    const monthly = Number(t.target_monthly ?? 0) || 0;
                    const weeklyAuto = weeklyFromMonthly(monthly);

                    return (
                      <div key={t.id} className="rounded-xl border bg-white p-3">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold">{label}</div>
                            <div className="text-xs text-black/60">
                              key: <span className="font-mono">{t.kpi_key}</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => patchTarget(t.id, { active: !t.active })}
                              className={`rounded-xl border px-3 py-2 text-xs ${
                                t.active ? "bg-green-50" : "bg-red-50"
                              }`}
                              disabled={saving}
                            >
                              {t.active ? "Active" : "Inactive"}
                            </button>

                            <button
                              onClick={() => removeTarget(t.id)}
                              className="rounded-xl border px-3 py-2 text-xs bg-white"
                              disabled={saving}
                            >
                              Remove
                            </button>
                          </div>
                        </div>

                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <label className="text-xs text-black/60">
                            Monthly target (you set)
                            <input
                              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                              type="number"
                              value={t.target_monthly ?? 0}
                              onChange={(e) =>
                                patchTarget(t.id, {
                                  target_monthly: e.target.value === "" ? 0 : Number(e.target.value),
                                })
                              }
                            />
                          </label>

                          <div className="text-xs text-black/60">
                            Weekly target (auto)
                            <div className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-gray-50">
                              {weeklyAuto}
                            </div>
                            <div className="mt-1 text-[11px] text-black/50">
                              Saved to DB on “Save targets”
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-3 text-xs text-black/60">
                Click <b>Save targets</b> after changes.
              </div>
            </div>
          </>
        ) : (
          /* ASSIGNMENTS TAB */
          <div className="rounded-2xl border bg-white p-5">
            <div className="text-sm font-semibold">Assign Daily KPI form</div>
            <div className="mt-1 text-xs text-black/60">
              Assign a KPI template to a user, or leave blank to use the role’s active template.
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <div className="text-sm font-medium mb-2">Team member</div>
                <select
                  className="w-full rounded-xl border px-3 py-2 bg-white text-sm"
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                >
                  {profiles.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name ?? u.id} {u.role ? `(${u.role})` : ""}
                    </option>
                  ))}
                </select>

                {selectedUser && (
                  <div className="mt-2 text-xs text-black/60">
                    Role: <span className="font-medium text-black">{selectedUser.role ?? "—"}</span>
                  </div>
                )}
              </div>

              <div>
                <div className="text-sm font-medium mb-2">Assign KPI template</div>
                <select
                  className="w-full rounded-xl border px-3 py-2 bg-white text-sm"
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                >
                  <option value="">(No assignment — fallback to active-by-role)</option>
                  {templatesForUser.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.role.toUpperCase()} — {t.name} {t.active ? "(ACTIVE)" : ""}
                    </option>
                  ))}
                </select>

                <div className="mt-2 text-xs text-black/60">
                  Tip: “No assignment” = user uses their role’s active template.
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border bg-gray-50 p-4">
              <div className="text-sm font-semibold mb-2">Effective setup</div>

              <div className="grid gap-2">
                <div className="text-xs text-black/70">
                  Assigned: <b>{assignedTemplate ? assignedTemplate.name : "None"}</b>
                </div>
                <div className="text-xs text-black/70">
                  Role active: <b>{roleActiveTemplate ? roleActiveTemplate.name : "None"}</b>
                </div>
                <div className="text-xs text-black/70">
                  Effective: <b>{effectiveTemplate ? effectiveTemplate.name : "None"}</b>
                </div>

                {isDirtyAssign ? (
                  <div className="mt-2 text-xs text-amber-900 rounded-xl border border-amber-200 bg-amber-50 p-2">
                    Unsaved changes
                  </div>
                ) : null}
              </div>

              <div className="mt-3 text-xs text-black/60 leading-relaxed">
                Effective template is what the user will see in <b>Daily KPIs</b>.
              </div>
            </div>

            <div className="mt-3 text-xs text-black/60">
              Click <b>Save assignment</b> to apply.
            </div>
          </div>
        )}

        {msg && (
          <div className="mt-4 rounded-xl border bg-gray-50 p-3 text-sm text-black">
            {msg}
          </div>
        )}
      </div>
    </div>
  );
}