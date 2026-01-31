"use client";

import React from "react";

export function AppShell({
  title,
  subtitle,
  right,
  children,
  maxWidth = "max-w-5xl",
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  return (
    <div className="min-h-[100dvh] bg-[#050807] text-white relative overflow-hidden">
      {/* ambient glows */}
      <div className="pointer-events-none absolute -top-24 left-1/2 h-[420px] w-[520px] -translate-x-1/2 rounded-full bg-emerald-400/25 blur-[120px]" />
      <div className="pointer-events-none absolute top-[35%] left-[-140px] h-[320px] w-[320px] rounded-full bg-emerald-500/20 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-[-140px] right-[-140px] h-[380px] w-[380px] rounded-full bg-emerald-400/15 blur-[120px]" />

      <div className={`mx-auto w-full ${maxWidth} p-4`}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {subtitle ? <div className="mt-1 text-xs text-white/60">{subtitle}</div> : null}
          </div>
          {right ? <div className="flex items-center gap-2">{right}</div> : null}
        </div>

        {children}
      </div>
    </div>
  );
}

export function GlassCard({
  children,
  className = "",
  glow = false,
}: {
  children: React.ReactNode;
  className?: string;
  glow?: boolean;
}) {
  return (
    <div
      className={[
        "relative rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl",
        "shadow-[0_20px_60px_rgba(0,0,0,0.55)]",
        glow ? "overflow-hidden" : "",
        className,
      ].join(" ")}
    >
      {glow ? (
        <div className="pointer-events-none absolute -top-20 -right-20 h-56 w-56 rounded-full bg-emerald-400/20 blur-[90px]" />
      ) : null}
      <div className="relative p-4">{children}</div>
    </div>
  );
}

export function NeonButton({
  children,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
}) {
  const base =
    "rounded-xl px-4 py-2 text-sm transition active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed";

  const styles =
    variant === "primary"
      ? "bg-white text-black hover:opacity-95"
      : variant === "secondary"
      ? "border border-white/10 bg-white/5 text-white hover:bg-white/10"
      : "text-white/80 hover:text-white hover:bg-white/5";

  return (
    <button {...props} className={`${base} ${styles} ${className}`}>
      {children}
    </button>
  );
}

export function NeonBadge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "green" | "blue" | "amber" | "red";
}) {
  const tones: Record<string, string> = {
    neutral: "border-white/10 bg-white/5 text-white/70",
    green: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
    blue: "border-sky-400/20 bg-sky-400/10 text-sky-100",
    amber: "border-amber-400/20 bg-amber-400/10 text-amber-100",
    red: "border-red-400/20 bg-red-400/10 text-red-100",
  };

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs ${tones[tone]}`}>
      {children}
    </span>
  );
}