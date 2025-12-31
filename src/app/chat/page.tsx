// src/app/chat/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import ChatSidebar from "@/app/components/ChatSidebar";
import SourcesFeedback from "../components/chat/SourcesFeedback";

type UserType = "internal" | "external";

type RecommendedDoc = {
  title: string;
  doc_type: string;
  path: string;
  url: string | null;
};

type SourceUsed = {
  chunkId: string;
  documentId: string;
  title: string | null;
  similarity: number;
  content: string;
};

type ChatResponse = {
  conversationId?: string;
  sessionId?: string; // ✅ learning continuity
  answer?: string;
  foldersUsed?: string[];
  recommendedDocs?: RecommendedDoc[];
  sourcesUsed?: SourceUsed[]; // ✅ sources for feedback UI
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
  deleted_at?: string | null;
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

function titleOrNew(title?: string | null) {
  const t = (title || "").trim();
  return t.length ? t : "New chat";
}

/** ✅ prevents "Unexpected end of JSON input" */
async function readJsonSafely<T = any>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }
}

export default function ChatPage() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  // profile-driven access
  const [role, setRole] = useState<ProfileRow["role"] | null>(null);
  const [userType, setUserType] = useState<UserType>("external");
  const [profileLoading, setProfileLoading] = useState(true);

  // auth + legacy conversation id
  const [userId, setUserId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);

  // ✅ learning continuity (new session id)
  const [sessionId, setSessionId] = useState<string | null>(null);

  // sidebar list
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [convoLoading, setConvoLoading] = useState(true);

  // UI
  const [historyLoading, setHistoryLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // chat
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([DEFAULT_GREETING]);
  const [loading, setLoading] = useState(false);

  // right panel
  const [lastDocs, setLastDocs] = useState<RecommendedDoc[]>([]);
  const [lastFolders, setLastFolders] = useState<string[]>([]);

  // ✅ sources panel under assistant response
  const [lastSources, setLastSources] = useState<SourceUsed[]>([]);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, historyLoading]);

  const lastUserMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") return messages[i].content;
    }
    return null;
  }, [messages]);

  const lastAssistantMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i].content;
    }
    return null;
  }, [messages]);

  const loadConversationMessages = useCallback(
    async (uid: string, cid: string) => {
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

        // sources are per-response; clear when switching history
        setLastSources([]);
      } finally {
        setHistoryLoading(false);
      }
    },
    [supabase]
  );

  const loadConversations = useCallback(
    async (uid: string) => {
      setConvoLoading(true);
      try {
        const { data, error } = await supabase
          .from("conversations")
          .select("id,title,updated_at,created_at,deleted_at")
          .eq("user_id", uid)
          .is("deleted_at", null)
          .order("updated_at", { ascending: false })
          .limit(50);

        if (error) console.error("CONVERSATIONS_LIST_ERROR:", error);

        const list = (data || []) as ConversationRow[];
        setConversations(list);
        return list;
      } finally {
        setConvoLoading(false);
      }
    },
    [supabase]
  );

  const createConversation = useCallback(
    async (uid: string) => {
      const { data: createdConv, error } = await supabase
        .from("conversations")
        .insert({ user_id: uid, title: "New chat" })
        .select("id,title,updated_at,created_at,deleted_at")
        .single();

      if (error) console.error("CONVERSATION_CREATE_ERROR:", error);
      return (createdConv || null) as ConversationRow | null;
    },
    [supabase]
  );

  const switchConversation = useCallback(
    async (cid: string) => {
      if (!userId) return;

      if (cid === conversationId) {
        setSidebarOpen(false);
        return;
      }

      setConversationId(cid);

      // reset per-conversation UI
      setLastDocs([]);
      setLastFolders([]);
      setLastSources([]);
      setSessionId(null);

      setInput("");
      setSidebarOpen(false);

      await loadConversationMessages(userId, cid);
    },
    [conversationId, loadConversationMessages, userId]
  );

  const renameConversation = useCallback(
    async (cid: string, title: string) => {
      if (!userId) return;

      const trimmed = title.trim();
      if (!trimmed) return;

      const { error } = await supabase
        .from("conversations")
        .update({ title: trimmed, updated_at: new Date().toISOString() })
        .eq("id", cid)
        .eq("user_id", userId);

      if (error) {
        console.error("CONVERSATION_RENAME_ERROR:", error);
        return;
      }

      await loadConversations(userId);
    },
    [supabase, userId, loadConversations]
  );

  const deleteConversation = useCallback(
    async (cid: string) => {
      if (!userId) return;

      const ok = window.confirm("Delete this chat? You can’t undo this.");
      if (!ok) return;

      const now = new Date().toISOString();

      const { error } = await supabase
        .from("conversations")
        .update({ deleted_at: now, updated_at: now })
        .eq("id", cid)
        .eq("user_id", userId);

      if (error) {
        console.error("CONVERSATION_DELETE_ERROR:", error);
        return;
      }

      const list = await loadConversations(userId);

      if (cid === conversationId) {
        const nextId = list?.[0]?.id ?? null;

        // reset UI
        setLastDocs([]);
        setLastFolders([]);
        setLastSources([]);
        setSessionId(null);
        setInput("");

        if (nextId) {
          setConversationId(nextId);
          await loadConversationMessages(userId, nextId);
        } else {
          const created = await createConversation(userId);
          const newId = created?.id ?? null;
          setConversationId(newId);
          setMessages([DEFAULT_GREETING]);
          await loadConversations(userId);
        }
      }
    },
    [
      userId,
      supabase,
      loadConversations,
      conversationId,
      loadConversationMessages,
      createConversation,
    ]
  );

  // boot
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const { data: userData, error: userErr } = await supabase.auth.getUser();
        if (!alive) return;

        if (userErr) console.error("AUTH_GET_USER_ERROR:", userErr);

        const user = userData.user;
        if (!user) {
          router.replace("/");
          return;
        }

        setUserId(user.id);

        // profile
        let { data: profile, error: profileErr } = await supabase
          .from("profiles")
          .select("role,user_type,email")
          .eq("id", user.id)
          .maybeSingle<ProfileRow>();

        if (!alive) return;
        if (profileErr) console.error("PROFILE_READ_ERROR:", profileErr);

        if (!profile) {
          const email = (user.email || "").trim().toLowerCase();
          const isInternal = email.endsWith("@anchorp.com");
          const user_type: UserType = isInternal ? "internal" : "external";
          const roleToSet: ProfileRow["role"] = isInternal ? "anchor_rep" : "external_rep";

          const { data: created, error: upsertErr } = await supabase
            .from("profiles")
            .upsert(
              { id: user.id, email, user_type, role: roleToSet, updated_at: new Date().toISOString() },
              { onConflict: "id" }
            )
            .select("role,user_type,email")
            .single<ProfileRow>();

          if (upsertErr) console.error("PROFILE_UPSERT_ERROR:", upsertErr);
          profile = created ?? null;
        }

        if (!alive) return;

        setRole(profile?.role ?? null);
        setUserType((profile?.user_type as UserType) ?? "external");

        // conversations
        const list = await loadConversations(user.id);
        if (!alive) return;

        let cid: string | null = list?.[0]?.id ?? null;
        if (!cid) {
          const created = await createConversation(user.id);
          cid = created?.id ?? null;
          await loadConversations(user.id);
        }

        if (!alive) return;

        setConversationId(cid);

        if (cid) await loadConversationMessages(user.id, cid);
        else setMessages([DEFAULT_GREETING]);
      } finally {
        if (!alive) return;
        setProfileLoading(false);
        setHistoryLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [createConversation, loadConversationMessages, loadConversations, router, supabase]);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/");
    router.refresh();
  }

  async function newChat() {
    if (!userId) return;

    // reset UI
    setMessages([DEFAULT_GREETING]);
    setLastDocs([]);
    setLastFolders([]);
    setLastSources([]);
    setSessionId(null);
    setInput("");

    const created = await createConversation(userId);
    if (!created?.id) return;

    setConversationId(created.id);
    setSidebarOpen(false);

    await loadConversations(userId);
    setMessages([DEFAULT_GREETING]);
  }

  function pushQuickPick(label: string) {
    setInput((prev) => {
      const p = prev.trim();
      if (!p) return label;
      if (p.toLowerCase().includes(label.toLowerCase())) return prev;
      return `${p} • ${label}`;
    });
  }

  const ready = !profileLoading && !historyLoading && !!userId && !!conversationId;
  const inputDisabled = !ready;

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    if (!userId || !conversationId) return;
    if (profileLoading || historyLoading) return;

    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setLoading(true);
    setLastSources([]); // clear stale sources for prior answer

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          userType,
          conversationId,
          sessionId, // ✅ pass learning session
        }),
      });

      if (res.status === 401) {
        router.replace("/");
        router.refresh();
        return;
      }

      const data = await readJsonSafely<ChatResponse>(res);

      if (!res.ok) {
        const msg = (data?.error ?? `HTTP ${res.status}`).toString();
        setMessages((m) => [...m, { role: "assistant", content: `I hit an error.\n\n${msg}` }]);
        return;
      }

      if (!data || typeof data.answer !== "string" || !data.answer.trim()) {
        const msg =
          typeof data?.error === "string" ? data.error : "Empty or invalid response from server.";
        setMessages((m) => [...m, { role: "assistant", content: `I hit an error.\n\n${msg}` }]);
        return;
      }

      if (data.sessionId) setSessionId(data.sessionId);

      const answerText = data.answer.trim();
      setMessages((m) => [...m, { role: "assistant", content: answerText }]);

      setLastDocs(Array.isArray(data.recommendedDocs) ? data.recommendedDocs : []);
      setLastFolders(Array.isArray(data.foldersUsed) ? data.foldersUsed : []);
      setLastSources(Array.isArray(data.sourcesUsed) ? data.sourcesUsed : []);

      // auto-title: first real user message sets the title if it's still "New chat"
      const current = conversations.find((c) => c.id === conversationId);
      const currentTitle = (current?.title || "").trim();
      if (!currentTitle || currentTitle.toLowerCase() === "new chat") {
        const nextTitle = text.slice(0, 48).trim() || "New chat";
        renameConversation(conversationId, nextTitle);
      }

      if (data.conversationId && data.conversationId !== conversationId) {
        setConversationId(data.conversationId);
      }

      await loadConversations(userId);
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `Network error: ${e?.message || String(e)}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  const hasDocs = lastDocs.length > 0;

  const roleLabel =
    role === "anchor_rep"
      ? "Anchor Rep"
      : role === "external_rep"
      ? "External Rep"
      : role === "admin"
      ? "Admin"
      : "no role";

  return (
    <main className="min-h-screen anchor-app-bg text-white">
      {/* Top bar */}
      <header className="sticky top-0 z-30 anchor-topbar">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
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
        {/* Desktop sidebar */}
        <div className="hidden md:block">
          <ChatSidebar
            conversations={conversations.map((c) => ({
              id: c.id,
              title: c.title,
              updated_at: c.updated_at || c.created_at || null,
            }))}
            activeId={conversationId}
            loading={convoLoading}
            onNewChat={newChat}
            onSelect={switchConversation}
            onRename={renameConversation}
            onDelete={deleteConversation}
          />
        </div>

        {/* Mobile sidebar */}
        {sidebarOpen && (
          <aside className="md:hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur shadow-[0_0_0_1px_rgba(255,255,255,0.06)]">
            <div className="border-b border-white/10 px-4 py-3 flex items-center justify-between">
              <div className="text-sm font-semibold">Chats</div>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="rounded-md border border-white/10 bg-black/35 px-3 py-1 text-[12px] text-white/80 hover:bg-black/55"
              >
                Close
              </button>
            </div>

            <div className="p-2">
              {conversations.map((c) => {
                const active = c.id === conversationId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => switchConversation(c.id)}
                    className={[
                      "w-full rounded-lg border px-3 py-2 text-left transition mb-1",
                      active
                        ? "border-emerald-300/25 bg-emerald-400/10"
                        : "border-white/10 bg-black/20 hover:bg-black/35",
                    ].join(" ")}
                  >
                    <div className="truncate text-[12px] font-semibold text-white/90">
                      {titleOrNew(c.title)}
                    </div>
                    <div className="text-[11px] text-white/55">
                      {formatWhen(c.updated_at || c.created_at)}
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>
        )}

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

              {/* ✅ Sources + Feedback (attached to the latest assistant response) */}
              {lastAssistantMessage && (
  <div className="max-w-[92%]">
    <SourcesFeedback
      sources={lastSources}              // may be []
      sessionId={sessionId}
      conversationId={conversationId}
      userMessage={lastUserMessage}
      assistantMessage={lastAssistantMessage}
    />
  </div>
)}



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
            <div className="px-3 pt-3">
              <div className="max-h-[92px] overflow-y-auto overflow-x-hidden pb-2 pr-1">
                <div className="flex flex-wrap gap-2">
                  {QUICK_PICKS.map((label) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => pushQuickPick(label)}
                      className="rounded-full border border-emerald-300/25 bg-emerald-400/10 px-3 py-1 text-[12px] text-emerald-100 hover:bg-emerald-400/15 disabled:opacity-60"
                      disabled={inputDisabled}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-3">
              <div className="flex w-full gap-2">
                <input
                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-3 text-sm outline-none placeholder:text-white/40 focus:border-emerald-300/30 disabled:opacity-60"
                  placeholder={inputDisabled ? "Loading your chat…" : 'Try: "U3400 PVC sales sheet"'}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={inputDisabled}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
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

        {/* Docs panel */}
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
