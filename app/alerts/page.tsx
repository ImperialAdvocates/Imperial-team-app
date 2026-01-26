"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type AlertRow = {
  id: string;
  severity: "green" | "amber" | "red";
  reason: string;
  alert_date: string;
  created_at: string;
  resolved_at: string | null;
  acknowledged_at: string | null;
};

export default function AlertsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  async function loadAlerts(uid: string) {
    setMessage(null);
    setLoading(true);

    const { data, error } = await supabase
      .from("performance_alerts")
      .select("id,severity,reason,alert_date,created_at,resolved_at,acknowledged_at")
      .eq("user_id", uid)
      // IMPORTANT: we are NOT filtering out old alerts anymore
      .order("created_at", { ascending: false });

    if (error) {
      setMessage(error.message);
      setAlerts([]);
      setLoading(false);
      return;
    }

    setAlerts((data ?? []) as AlertRow[]);
    setLoading(false);
  }

  useEffect(() => {
    async function init() {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;

      if (!session) {
        router.push("/login");
        return;
      }

      setUserId(session.user.id);
      await loadAlerts(session.user.id);
    }

    init();
  }, [router]);

  async function acknowledgeAlert(id: string) {
    if (!userId) return;

    setMessage(null);

    const { error } = await supabase
      .from("performance_alerts")
      .update({ acknowledged_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userId);

    if (error) {
      setMessage(error.message);
      return;
    }

    await loadAlerts(userId);
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Alerts</h1>
          <button
            onClick={() => router.push("/hub")}
            className="rounded-xl border px-4 py-2 text-sm bg-white"
          >
            Back
          </button>
        </div>

        {loading ? (
          <div className="rounded-xl border bg-white p-4 text-sm">Loading…</div>
        ) : alerts.length === 0 ? (
          <div className="rounded-xl border bg-green-50 p-4 text-sm">
            🟢 No alerts yet.
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.map((a) => (
              <div key={a.id} className="rounded-2xl border p-4 bg-white">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm text-gray-500">
                      {a.alert_date} •{" "}
                      {a.severity === "red"
                        ? "🔴 Red"
                        : a.severity === "amber"
                        ? "🟠 Amber"
                        : "🟢 Green"}
                    </div>

                    <div className="mt-1 text-sm">{a.reason}</div>

                    <div className="mt-2 text-xs text-gray-500">
                      {a.acknowledged_at ? "Seen ✅" : "Not seen yet"}
                    </div>
                  </div>

                  <button
                    onClick={() => acknowledgeAlert(a.id)}
                    className={`shrink-0 rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 ${
                      a.acknowledged_at ? "opacity-50 cursor-default" : ""
                    }`}
                    disabled={!!a.acknowledged_at}
                  >
                    {a.acknowledged_at ? "Acknowledged" : "Acknowledge"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {message && (
          <div className="mt-4 rounded-xl border bg-gray-50 p-3 text-sm text-gray-700">
            {message}
          </div>
        )}
      </div>
    </div>
  );
}