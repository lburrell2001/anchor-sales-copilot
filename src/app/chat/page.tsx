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
  conversationId?: string;
  answer: string;
  foldersUsed?: string[];
  recommendedDocs?: RecommendedDoc[];
  error?: string;
};

type Msg = { role: "user" | "assistant"; content: string };

type ProfileRow = {
  role: "admin" | "anchor_rep" | "external_rep";
  user_type: UserType;
  email: string;
};

type ConversationRow = {
  id: string;
  title: string | null;
  updated_at: string | null;
  created_at: string | null;
};

type MessageRow = {
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

const QUICK_PICKS: string[] = [
  "U2400 EPDM",
  "Metal deck",
  "Concrete deck",
  "Wind speed unknown",
  "HVAC unit (RTU)",
  "Satellite dish",
];

const DEFAULT_GREETING: Msg = {
  role: "assistant",
  content:
    "Anchor Sales Co-Pilot ready.\nTell me what you’re mounting and what roof/membrane you’re working with (ex: U2400 EPDM), and I’ll pull the right docs.",
};

function formatWhen(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function ChatPage() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  // ✅ profile-driven access
  const [role, setRole] = useState<ProfileRow["role"] | null>(null);
  const [userType, setUserType] = useState<UserType>("external");
  const [profileLoading, setProfileLoading] = useState(true);

  // ✅ per-user chat memory + sidebar
  const [userId, setUserId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([DEFAULT_GREETING]);
  const [loading, setLoading] = useState(false);
  const [lastDocs, setLastDocs] = useState<RecommendedDoc[]>([]);
  const [lastFolders, setLastFolders] = useState<string[]>([]);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function loadConversationMessages(uid: string, cid: string) {
    setHistoryLoading(true);
    try {
      const { data: rows, error: msgErr } = await supabase
        .from("messages")
        .select("role,content,created_at")
        .eq("conversation_id", cid)
        .eq("user_id", uid)
        .order("created_at", { ascending: true })
        .limit(500);

      if (msgErr) console.error("MESSAGES_LOAD_ERROR:", msgErr);

      if (rows && rows.length > 0) {
        setMessages(rows.map((r: MessageRow) => ({ role: r.role, content: r.content })));
      } else {
        setMessages([DEFAULT_GREETING]);
      }
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadConversations(uid: string) {
    const { data, error } = await supabase
      .from("conversations")
      .select("id,title,updated_at,created_at")
      .eq("user_id", uid)
      .order("updated_at", { ascending: false })
      .limit(50);

    if (error) console.error("CONVERSATIONS_LIST_ERROR:", error);
    setConversations((data || []) as ConversationRow[]);
    return (data || []) as ConversationRow[];
  }

  async function createConversation(uid: string) {
    const { data: createdConv, error } = await supabase
      .from("conversations")
      .insert({ user_id: uid, title: "New chat" })
      .select("id,title,updated_at,created_at")
      .single();

    if (error) console.error("CONVERSATION_CREATE_ERROR:", error);
    return (createdConv || null) as ConversationRow | null;
  }

  // ✅ Load user + profile + conversations + latest messages (first paint)
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

        setUserId(user.id);

        // 2) Try read profile
        let {
          data: profile,
          error: profileErr,
        }: { data: ProfileRow | null; error: any } = await supabase
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
          const roleToSet: ProfileRow["role"] = isInternal ? "anchor_rep" : "external_rep";

          const { data: created, error: upsertErr } = await supabase
            .from("profiles")
            .upsert(
              {
                id: user.id,
                email,
                user_type,
                role: roleToSet,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "id" }
            )
            .select("role,user_type,email")
            .single();

          if (upsertErr) console.error("PROFILE_UPSERT_ERROR:", upsertErr);
          profile = (created as ProfileRow) ?? null;
        }

        if (!alive) return;

        // 4) Set UI state
        setRole(profile?.role ?? null);
        setUserType((profile?.user_type as UserType) ?? "external");

        // 5) Load conversation list
        const list = await loadConversations(user.id);
        if (!alive) return;

        // 6) Pick latest conversation or create one
        let cid = list?.[0]?.id ?? null;
        if (!cid) {
          const created = await createConversation(user.id);
          cid = created?.id ?? null;

          // refresh list so sidebar shows it
          await loadConversations(user.id);
        }

        if (!alive) return;

        setConversationId(cid);

        // 7) Load messages
        if (cid) await loadConversationMessages(user.id, cid);
        else setMessages([DEFAULT_GREETING]);
      } finally {
        if (alive) setProfileLoading(false);
        // historyLoading is managed by loadConversationMessages()
        if (alive && !conversationId) setHistoryLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, router]);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/");
    router.refresh();
  }

  async function newChat() {
    if (!userId) return;

    setMessages([DEFAULT_GREETING]);
    setLastDocs([]);
    setLastFolders([]);
    setInput("");

    const created = await createConversation(userId);
    if (!created?.id) return;

    setConversationId(created.id);
    setSidebarOpen(false);

    // refresh list + load empty messages
    await loadConversations(userId);
    setMessages([DEFAULT_GREETING]);
  }

  async function switchConversation(cid: string) {
    if (!userId) return;
    if (cid === conversationId) {
      setSidebarOpen(false);
      return;
    }

    setConversationId(cid);
    setLastDocs([]);
    setLastFolders([]);
    setInput("");
    setSidebarOpen(false);

    await loadConversationMessages(userId, cid);
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
    if (!text || loading || profileLoading || historyLoading) return;
    if (!conversationId) return;

    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, userType, conversationId }),
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

        if (data.conversationId && data.conversationId !== conversationId) {
          setConversationId(data.conversationId);
        }

        // refresh sidebar order/title after message (server updates updated_at/title)
        if (userId) await loadConversations(userId);
      }
    } catch (e: any) {
      setMessages((m) => [...m, { role: "assistant", content: `Network error: ${e?.message || e}` }]);
    } finally {
      setLoading(false);
    }
  }

  const hasDocs = lastDocs && lastDocs.length > 0;

  const roleLabel =
    role === "anchor_rep" ? "Anchor Rep" : role === "external_rep" ? "External Rep" : role === "admin" ? "Admin" : "no role";

  const inputDisabled = profileLoading || historyLoading;

  return (
    <main className="min-h-screen anchor-app-bg text-white">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 anchor-topbar">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            {/* Mobile sidebar toggle */}
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              className="md:hidden h-9 rounded-md border border-white/10 bg-black/40 px-3 text-[12px] font-semibold text-white/80 hover:bg-black/60 transition"
            >
              Menu
            </button>

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

          {/* Role + actions */}
          <div className="flex items-center gap-2">
            <div className="rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-white/70">
              {profileLoading ? "…" : roleLabel}
            </div>

            <button
              type="button"
              onClick={newChat}
              className="h-9 rounded-md border border-white/10 bg-black/40 px-3 text-[12px] font-semibold text-white/80 hover:bg-black/60 transition"
              title="Start a new chat"
            >
              New chat
            </button>

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
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 px-4 py-4 md:grid-cols-[280px_1fr_320px]">
        {/* Sidebar */}
        <aside
          className={[
            "rounded-xl border border-white/10 bg-white/5 backdrop-blur shadow-[0_0_0_1px_rgba(255,255,255,0.06)]",
            "md:block",
            sidebarOpen ? "block" : "hidden md:block",
          ].join(" ")}
        >
          <div className="border-b border-white/10 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">Chats</div>
              <button
                type="button"
                onClick={newChat}
                className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-white/80 hover:bg-black/50 transition"
              >
                + New
              </button>
            </div>
            <div className="mt-1 text-[12px] text-white/60">Your recent conversations</div>
          </div>

          <div className="p-2">
            {conversations.length === 0 ? (
              <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-sm text-white/70">
                No chats yet.
              </div>
            ) : (
              <div className="space-y-1">
                {conversations.map((c) => {
                  const active = c.id === conversationId;
                  const label = (c.title || "New chat").trim();
                  const when = formatWhen(c.updated_at || c.created_at);

                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => switchConversation(c.id)}
                      className={[
                        "w-full rounded-lg border px-3 py-2 text-left transition",
                        active
                          ? "border-emerald-300/25 bg-emerald-400/10"
                          : "border-white/10 bg-black/20 hover:bg-black/35",
                      ].join(" ")}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-[12px] font-semibold text-white/90">
                            {label}
                          </div>
                          <div className="text-[11px] text-white/55">{when}</div>
                        </div>
                        {active ? (
                          <div className="shrink-0 rounded-md border border-emerald-300/20 bg-emerald-400/10 px-2 py-1 text-[10px] text-emerald-100">
                            Active
                          </div>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

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

              {(historyLoading || loading) && (
                <div className="max-w-[92%] rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white/80">
                  {historyLoading ? "Loading chat…" : "Thinking…"}
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
                      disabled={inputDisabled}
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
                  placeholder={inputDisabled ? "Loading your chat…" : 'Try: "U3400 PVC sales sheet"'}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={inputDisabled}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") send();
                  }}
                />
                <button
                  onClick={send}
                  disabled={loading || inputDisabled}
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
