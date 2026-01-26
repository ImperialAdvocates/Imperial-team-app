"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type DocItem = {
  title: string;
  description?: string;
  url: string;
  tag?: string;
};

export default function DocumentsPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const docs: DocItem[] = useMemo(
    () => [
      {
        title: "Co-Living Informative Video",
        description: "Overview video explaining the co-living model and numbers.",
        url: "https://drive.google.com/file/d/1LqtiozlIMxnTbF8MgDAAqvUHPFo0x3Af/view",
        tag: "Video",
      },
      {
        title: "Co-Living Information Booklet",
        description: "Detailed breakdown of co-living strategy, demand, and returns.",
        url: "https://docs.google.com/document/d/1LyCPs7_yiJsYf-Ntnst1s0cyUTKHXTlE/view",
        tag: "Booklet",
      },
      {
        title: "NDIS Information Booklet",
        description: "NDIS overview, SDA explanation, and investment fundamentals.",
        url: "https://docs.google.com/document/d/1C_HIS4NpNDaEpjtrtHjcdKteRXoBZcJs/view",
        tag: "NDIS",
      },
    ],
    []
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter((d) => {
      const hay = `${d.title} ${d.description ?? ""} ${d.tag ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [docs, query]);

  return (
    <div className="min-h-[100dvh] bg-gray-50 p-4">
      <div className="mx-auto w-full max-w-3xl">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-2xl font-semibold">Documents</h1>
            <p className="mt-1 text-xs text-black/60">
              Staff-only reference documents (Google Drive).
            </p>
          </div>

          <button
            onClick={() => router.push("/hub")}
            className="rounded-xl border bg-white px-3 py-2 text-xs"
          >
            Back to Hub
          </button>
        </div>

        {/* Search */}
        <div className="rounded-2xl border bg-white p-4 mb-4">
          <div className="text-xs font-semibold text-black/60">Search</div>
          <input
            className="mt-2 w-full rounded-xl border px-3 py-2 text-sm"
            placeholder="Search documents…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {/* Documents */}
        <div className="grid gap-3">
          {filtered.map((d) => (
            <div key={d.title} className="rounded-2xl border bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{d.title}</div>
                  {d.description && (
                    <div className="mt-1 text-xs text-black/60">
                      {d.description}
                    </div>
                  )}
                  {d.tag && (
                    <div className="mt-2 inline-flex rounded-full border px-2 py-1 text-[11px]">
                      {d.tag}
                    </div>
                  )}
                </div>

                <a
                  href={d.url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-xl bg-black px-3 py-2 text-xs text-white"
                >
                  Open
                </a>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 text-[11px] text-black/50">
          All links are view-only. Contact an admin if access changes are required.
        </div>
      </div>
    </div>
  );
}