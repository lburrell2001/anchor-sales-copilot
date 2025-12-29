"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

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

export default function ChatPage() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  // ✅ profile-driven access
  const [role, setRole] = useState<string | null>(null);
  const [userType, setUserType] = useState<UserType>("external");
  const [profileLoading, setProfileLoading] = useState(true);

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

  // ✅ Load user + profile once (role + user_type)
  useEffect(() => {
  let alive = true;

  (async () => {
    try {
      // 1) Confirm user session
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (!alive) return;

      if (userErr) console.error("AUTH_GET_USER_ERROR:", userErr);

      const user = userData.user;
      if (!user) {
        router.replace("/");
        return;
      }

      // 2) Try read profile
      let { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select("role,user_type,email")
        .eq("id", user.id)
        .maybeSingle();

      if (!alive) return;

      if (profileErr) console.error("PROFILE_READ_ERROR:", profileErr);

      // 3) If missing, self-heal: create profile based on email domain
      if (!profile) {
        const email = (user.email || "").trim().toLowerCase();
        const isInternal = email.endsWith("@anchorp.com");

        const user_type: UserType = isInternal ? "internal" : "external";
        const role = isInternal ? "anchor_rep" : "external_rep";

        const { data: created, error: upsertErr } = await supabase
          .from("profiles")
          .upsert(
            {
              id: user.id,
              email,
              user_type,
              role,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "id" }
          )
          .select("role,user_type")
          .single();

        if (upsertErr) console.error("PROFILE_UPSERT_ERROR:", upsertErr);

        profile = created ?? null;
      }

      if (!alive) return;

      // 4) Set UI state
      setRole(profile?.role ?? null);
      setUserType((profile?.user_type as UserType) ?? "external");
    } finally {
      if (alive) setProfileLoading(false);
    }
  })();

  return () => {
    alive = false;
  };
}, [supabase, router]);



  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/");
    router.refresh();
  }

  function pushQuickPick(label: string) {
    setInput((prev) => {
      const p = prev.trim();
      if (!p) return label;
      if (p.toLowerCase().includes(label.toLowerCase())) return prev;
      return `${p} • ${label}`;
    });
  }

  async function send() {
    const text = input.trim();
    if (!text || loading || profileLoading) return;

    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, userType }),
      });

      if (res.status === 401) {
        router.replace("/");
        router.refresh();
        return;
      }

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
            <button
              onClick={() => window.location.reload()}
              className="h-9 w-9 rounded-md bg-black/60 border border-white/10 flex items-center justify-center hover:bg-black/80 transition"
              type="button"
              title="Refresh"
              aria-label="Refresh"
            >
              <img src="/anchorp.svg" alt="Anchor Products" className="h-10 w-auto" />
            </button>

            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-wide">Anchor Sales Co-Pilot</div>
              <div className="text-[12px] text-white/60">Docs • Specs • Install • Downloads</div>
            </div>
          </div>

          {/* Role + Sign out */}
          <div className="flex items-center gap-2">
            <div className="rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-white/70">
              {profileLoading ? "…" : role ? role.replace("_", " ") : "no role"}
            </div>

            <button
              type="button"
              onClick={signOut}
              className="h-9 rounded-md border border-white/10 bg-black/40 px-3 text-[12px] font-semibold text-white/80 hover:bg-black/60 transition"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-4 px-4 py-4 md:grid-cols-[1fr_320px]">
        {/* Chat */}
        <section className="rounded-xl border border-white/10 bg-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur">
          <div className="border-b border-white/10 px-4 py-3">
            <div className="text-xs text-white/70">
              Ask like: “U2400 EPDM install manual + data sheet” or “HVAC solution docs”
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

            {/* Input row */}
            <div className="p-3">
              <div className="flex w-full gap-2">
                <input
                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-3 text-sm outline-none placeholder:text-white/40 focus:border-emerald-300/30 disabled:opacity-60"
                  placeholder={profileLoading ? "Loading your access…" : 'Try: "U3400 PVC sales sheet"'}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={profileLoading}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") send();
                  }}
                />
                <button
                  onClick={send}
                  disabled={loading || profileLoading}
                  className="shrink-0 rounded-lg bg-gradient-to-r from-emerald-400 to-lime-400 px-5 py-3 text-sm font-semibold text-black shadow disabled:opacity-50"
                  type="button"
                >
                  Send
                </button>
              </div>

              <div className="mt-2 text-[11px] text-white/50">
                Tip: include membrane + series (ex: “U2600 SBS Torch”) so I can pull the exact folder.
              </div>

              {!profileLoading && (
                <div className="mt-2 text-[11px] text-white/40">
                  Access mode: <span className="text-white/60">{userType}</span>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Docs Panel */}
        <aside className="rounded-xl border border-white/10 bg-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur">
          <div className="border-b border-white/10 px-4 py-3">
            <div className="text-sm font-semibold">Recommended documents</div>
            <div className="mt-1 text-[12px] text-white/60">Tap to download/share</div>
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
                        <div className="truncate text-sm font-semibold">{d.title}</div>
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
                <div className="text-[11px] font-semibold text-white/70">Folders used</div>
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
