"use client";

import { useEffect, useRef, useState } from "react";

type UserType = "internal" | "external";

type RecommendedDoc = {
  title: string;
  doc_type: string;
  path: string;
  url: string | null;
};

type ChatResponse = {
  answer: string;
  foldersUsed?: string[];
  recommendedDocs?: RecommendedDoc[];
  error?: string;
};

type Msg = { role: "user" | "assistant"; content: string };

const QUICK_PICKS: string[] = [
  "U2400 EPDM",
  "Metal deck",
  "Concrete deck",
  "Wind speed unknown",
  "HVAC unit (RTU)",
  "Satellite dish",
];

export default function Home() {
  const [userType, setUserType] = useState<UserType>("external");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "Anchor Sales Co-Pilot ready.\nTell me what you’re mounting and what roof/membrane you’re working with (ex: U2400 EPDM), and I’ll pull the right docs.",
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [lastDocs, setLastDocs] = useState<RecommendedDoc[]>([]);
  const [lastFolders, setLastFolders] = useState<string[]>([]);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function pushQuickPick(label: string) {
    setInput((prev) => {
      const p = prev.trim();
      if (!p) return label;
      // avoid duplicates if user taps the same chip repeatedly
      if (p.toLowerCase().includes(label.toLowerCase())) return prev;
      return `${p} • ${label}`;
    });
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, userType }),
      });

      const data: ChatResponse = await res.json();

      if (!res.ok || data.error) {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content:
              "I hit an error. If this keeps happening, we’ll check your API keys/billing + server logs.\n\n" +
              (data.error || `HTTP ${res.status}`),
          },
        ]);
      } else {
        setMessages((m) => [...m, { role: "assistant", content: data.answer }]);
        setLastDocs(data.recommendedDocs || []);
        setLastFolders(data.foldersUsed || []);
      }
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `Network error: ${e?.message || e}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  const hasDocs = lastDocs && lastDocs.length > 0;

  return (
    <main className="min-h-screen anchor-app-bg text-white">
      {/* Top Bar */}
      <header className="sticky top-0 z-20 anchor-topbar">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            {/* Replace this with your anchorp.svg block if you already did */}
            <button
               onClick={() => window.location.reload()}
               className="h-9 w-9 rounded-md bg-black/60 border border-white/10 flex items-center justify-center hover:bg-black/80 transition"
               >
                <img
                  src="/anchorp.svg"
                  alt="Anchor Products"
                  className="h-10 w-auto"
                />
            </button>


            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-wide">
                Anchor Sales Co-Pilot
              </div>
              <div className="text-[12px] text-white/60">
                Docs • Specs • Install • Downloads
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:block text-[12px] text-white/60">Mode</div>
            <div className="flex rounded-md border border-white/10 bg-white/5 p-1">
              <button
                className={[
                  "px-3 py-1.5 text-xs font-semibold rounded-md transition",
                  userType === "external"
                    ? "bg-emerald-400/20 text-emerald-200 border border-emerald-300/20"
                    : "text-white/70 hover:text-white",
                ].join(" ")}
                onClick={() => setUserType("external")}
                type="button"
              >
                External
              </button>
              <button
                className={[
                  "px-3 py-1.5 text-xs font-semibold rounded-md transition",
                  userType === "internal"
                    ? "bg-emerald-400/20 text-emerald-200 border border-emerald-300/20"
                    : "text-white/70 hover:text-white",
                ].join(" ")}
                onClick={() => setUserType("internal")}
                type="button"
              >
                Internal
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-4 px-4 py-4 md:grid-cols-[1fr_320px]">
        {/* Chat */}
        <section className="rounded-xl border border-white/10 bg-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur">
          <div className="border-b border-white/10 px-4 py-3">
            <div className="text-xs text-white/70">
              Ask like: “U2400 EPDM install manual + data sheet” or “HVAC
              solution docs”
            </div>
          </div>

          <div className="h-[62vh] overflow-y-auto px-4 py-4">
            <div className="space-y-3">
              {messages.map((m, idx) => (
                <div
                  key={idx}
                  className={[
                    "max-w-[92%] whitespace-pre-wrap rounded-xl px-4 py-3 text-sm leading-relaxed",
                    m.role === "user"
                      ? "ml-auto bg-emerald-400/15 border border-emerald-300/15"
                      : "bg-black/40 border border-white/10",
                  ].join(" ")}
                >
                  {m.content}
                </div>
              ))}

              {loading && (
                <div className="max-w-[92%] rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white/80">
                  Thinking…
                </div>
              )}

              <div ref={scrollRef} />
            </div>
          </div>

          {/* Composer */}
          <div className="border-t border-white/10">
            {/* Quick picks */}
            <div className="px-3 pt-3">
  {/* Chip tray: wraps into rows, scrolls inside the tray */}
  <div className="max-h-[92px] overflow-y-auto overflow-x-hidden pb-2 pr-1">
    <div className="flex flex-wrap gap-2">
      {QUICK_PICKS.map((label) => (
        <button
          key={label}
          type="button"
          onClick={() => pushQuickPick(label)}
          className="rounded-full border border-emerald-300/25 bg-emerald-400/10 px-3 py-1 text-[12px] text-emerald-100 hover:bg-emerald-400/15"
        >
          {label}
        </button>
      ))}
    </div>
  </div>
</div>


            {/* Input row (FULL WIDTH) */}
            <div className="p-3">
              <div className="flex w-full gap-2">
                <input
                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-3 text-sm outline-none placeholder:text-white/40 focus:border-emerald-300/30"
                  placeholder='Try: "U3400 PVC sales sheet"'
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") send();
                  }}
                />
                <button
                  onClick={send}
                  disabled={loading}
                  className="shrink-0 rounded-lg bg-gradient-to-r from-emerald-400 to-lime-400 px-5 py-3 text-sm font-semibold text-black shadow disabled:opacity-50"
                  type="button"
                >
                  Send
                </button>
              </div>

              <div className="mt-2 text-[11px] text-white/50">
                Tip: include membrane + series (ex: “U2600 SBS Torch”) so I can
                pull the exact folder.
              </div>
            </div>
          </div>
        </section>

        {/* Docs Panel */}
        <aside className="rounded-xl border border-white/10 bg-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur">
          <div className="border-b border-white/10 px-4 py-3">
            <div className="text-sm font-semibold">Recommended documents</div>
            <div className="mt-1 text-[12px] text-white/60">
              Tap to download/share
            </div>
          </div>

          <div className="p-3">
            {!hasDocs ? (
              <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-sm text-white/70">
                No docs yet. Ask a question to pull files from Storage.
              </div>
            ) : (
              <div className="space-y-2">
                {lastDocs.map((d, i) => (
                  <a
                    key={i}
                    href={d.url || "#"}
                    target="_blank"
                    rel="noreferrer"
                    className={[
                      "block rounded-lg border px-3 py-2 transition",
                      d.url
                        ? "border-white/10 bg-black/35 hover:border-emerald-300/25 hover:bg-black/50"
                        : "border-white/10 bg-black/20 opacity-60 pointer-events-none",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">
                          {d.title}
                        </div>
                        <div className="text-[11px] text-white/60">
                          {d.doc_type} • {d.path}
                        </div>
                      </div>
                      <div className="shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/80">
                        Open
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            )}

            {lastFolders?.length ? (
              <div className="mt-3 rounded-lg border border-white/10 bg-black/30 p-3">
                <div className="text-[11px] font-semibold text-white/70">
                  Folders used
                </div>
                <div className="mt-1 space-y-1 text-[11px] text-white/55">
                  {lastFolders.map((f) => (
                    <div key={f} className="break-words">
                      {f}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </main>
  );
}
