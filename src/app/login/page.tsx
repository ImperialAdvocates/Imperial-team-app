"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // If already logged in, send to hub
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.push("/hub");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setLoading(true);

    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName },
          },
        });

        if (error) throw error;

        setMessage(
          "Signup successful. If email confirmation is enabled, check your inbox. Otherwise, you can log in now."
        );
        setMode("login");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;

        router.push("/hub");
      }
    } catch (err: any) {
      setMessage(err?.message ?? "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-sm">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Imperial Advocates Team Hub</h1>
          <p className="text-sm text-gray-600 mt-1">
            {mode === "login" ? "Log in to continue." : "Create your staff account."}
          </p>
        </div>

        <div className="flex gap-2 mb-5">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`flex-1 rounded-xl border px-3 py-2 text-sm ${
              mode === "login" ? "bg-gray-900 text-white" : "bg-white"
            }`}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`flex-1 rounded-xl border px-3 py-2 text-sm ${
              mode === "signup" ? "bg-gray-900 text-white" : "bg-white"
            }`}
          >
            Sign up
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === "signup" && (
            <div>
              <label className="text-sm font-medium">Full name</label>
              <input
                className="mt-1 w-full rounded-xl border px-3 py-2"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Akshat Sharma"
                required
              />
            </div>
          )}

          <div>
            <label className="text-sm font-medium">Email</label>
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="name@imperialadvocates.com"
              required
            />
          </div>

          <div>
            <label className="text-sm font-medium">Password</label>
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="••••••••"
              required
              minLength={6}
            />
          </div>

          <button
            disabled={loading}
            className="w-full rounded-xl bg-gray-900 px-4 py-2 text-white disabled:opacity-60"
            type="submit"
          >
            {loading ? "Please wait..." : mode === "login" ? "Log in" : "Create account"}
          </button>
        </form>

        {message && (
          <div className="mt-4 rounded-xl border bg-gray-50 p-3 text-sm text-gray-700">
            {message}
          </div>
        )}

        <div className="mt-6 text-xs text-gray-500">
          Staff-only access. Contact an admin if you need access.
        </div>
      </div>
    </div>
  );
}