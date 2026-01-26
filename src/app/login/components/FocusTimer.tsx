"use client";

import { useEffect, useState } from "react";

const TOTAL_SECONDS = 45 * 60; // 45 minutes
const STORAGE_KEY = "hub-focus-timer";

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export default function FocusTimer() {
  const [secondsLeft, setSecondsLeft] = useState(TOTAL_SECONDS);
  const [running, setRunning] = useState(false);

  // Load from storage
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      setSecondsLeft(parsed.secondsLeft ?? TOTAL_SECONDS);
      setRunning(parsed.running ?? false);
    }
  }, []);

  // Persist to storage
  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ secondsLeft, running })
    );
  }, [secondsLeft, running]);

  // Tick
  useEffect(() => {
    if (!running) return;

    const interval = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          setRunning(false);
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [running]);

  return (
    <div className="rounded-2xl border bg-white p-4 flex items-center justify-between gap-4">
      <div>
        <div className="text-xs text-black/60">Focus Timer</div>
        <div className="text-2xl font-semibold">
          {formatTime(secondsLeft)}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setRunning((r) => !r)}
          className="rounded-xl bg-black px-4 py-2 text-xs text-white"
        >
          {running ? "Pause" : "Start"}
        </button>

        <button
          onClick={() => {
            setRunning(false);
            setSecondsLeft(TOTAL_SECONDS);
          }}
          className="rounded-xl border px-3 py-2 text-xs bg-white"
        >
          Reset
        </button>
      </div>
    </div>
  );
}