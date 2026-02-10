// src/app/chat/page.tsx
"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
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
  sessionId?: string;
  answer?: string;
  foldersUsed?: string[];
  recommendedDocs?: RecommendedDoc[];
  sourcesUsed?: SourceUsed[];
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

function renderMessageContent(content: string) {
  const parts = String(content || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) {
    return <div className="text-black whitespace-pre-line">{content}</div>;
  }
  return (
    <div className="space-y-2">
      {parts.map((p, i) => (
        <div key={i} className="text-black whitespace-pre-line">
          {p}
        </div>
      ))}
    </div>
  );
}

const DEFAULT_GREETING: Msg = {
  role: "assistant",
  content:
    "Anchor Sales Co-Pilot ready.\nTell me what you’re mounting and your roof/membrane type (ex: U2400 EPDM), and I’ll recommend the right Anchor solution.",
};

function titleOrNew(title?: string | null) {
  const t = (title || "").trim();
  return t.length ? t : "New chat";
}

/** prevents "Unexpected end of JSON input" */
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
  const goAdmin = useCallback(() => {
    router.push("/admin/knowledge");
  }, [router]);

  const supabase = useMemo(() => supabaseBrowser(), []);

  // profile-driven access
  const [role, setRole] = useState<ProfileRow["role"] | null>(null);
  const [userType, setUserType] = useState<UserType>("external");
  const [profileLoading, setProfileLoading] = useState(true);

  // auth + conversation id
  const [userId, setUserId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);

  // learning continuity
  const [sessionId, setSessionId] = useState<string | null>(null);

  // sidebar list
  const [conversations, setConversations] = useState<ConversationRow[]>([]);

  // UI
  const [historyLoading, setHistoryLoading] = useState(true);

  // chat
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([DEFAULT_GREETING]);
  const [loading, setLoading] = useState(false);

  // feedback (opt-in)
  const [showFeedback, setShowFeedback] = useState(false);

  // sources for feedback component
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

  const isDefaultGreeting = useMemo(() => {
    const t = (lastAssistantMessage || "").trim();
    return t === DEFAULT_GREETING.content.trim();
  }, [lastAssistantMessage]);

  const canShowFeedback = useMemo(() => {
    if (!lastAssistantMessage) return false;
    if (isDefaultGreeting) return false;
    return true;
  }, [isDefaultGreeting, lastAssistantMessage]);

  const loadConversationMessages = useCallback(
    async (uid: string, cid: string) => {
      setHistoryLoading(true);
      try {
        const { data: rows, error: msgErr } = await supabase
          .from("messages")
          .select("role,content,meta,created_at")
          .eq("conversation_id", cid)
          .eq("user_id", uid)
          .order("created_at", { ascending: true })
          .limit(500);

        if (msgErr) console.error("MESSAGES_LOAD_ERROR:", msgErr);

        if (rows && rows.length > 0) {
          const display: Msg[] = [];

          for (const r of rows as any[]) {
            const role = r.role as "user" | "assistant";
            const content = (r.content ?? "").toString();

            // skip docs-only blank assistant rows (we don't have docs panel anymore)
            if (role === "assistant" && !content.trim()) continue;

            display.push({ role, content });
          }

          setMessages(display as any);
        } else {
          setMessages([DEFAULT_GREETING] as any);
        }

        setLastSources([]);
        setShowFeedback(false);
      } finally {
        setHistoryLoading(false);
      }
    },
    [supabase]
  );

  const loadConversations = useCallback(
    async (uid: string) => {
      // no sidebar; keep list for auto-title only
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
        // no sidebar; keep list for auto-title only
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

  const switchConversation = useCallback(
    async (cid: string) => {
      if (!userId) return;

      if (cid === conversationId) {
        return;
      }

      setConversationId(cid);

      // reset per-conversation UI
      setLastSources([]);
      setSessionId(null);
      setInput("");
      setShowFeedback(false);

      await loadConversationMessages(userId, cid);
    },
    [conversationId, loadConversationMessages, userId]
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

        setLastSources([]);
        setSessionId(null);
        setInput("");
        setShowFeedback(false);

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

  async function newChat() {
    if (!userId) return;

    setMessages([DEFAULT_GREETING]);
    setLastSources([]);
    setSessionId(null);
    setInput("");
    setShowFeedback(false);

    const created = await createConversation(userId);
    if (!created?.id) return;

    setConversationId(created.id);

    await loadConversations(userId);
    setMessages([DEFAULT_GREETING]);
  }

  const ready = !profileLoading && !historyLoading && !!userId && !!conversationId;
  const inputDisabled = !ready;

  const roleLabel = useMemo(() => {
    if (role === "anchor_rep") return "Anchor Rep";
    if (role === "external_rep") return "External Rep";
    if (role === "admin") return "Admin";
    return "no role";
  }, [role]);

async function send() {
  const text = input.trim();
  if (!text || loading) return;
  if (!userId || !conversationId) return;
  if (profileLoading || historyLoading) return;

  setShowFeedback(false);

  // optimistic UI append
  const nextMessages: Msg[] = [...messages, { role: "user", content: text }];
  setMessages(nextMessages);
  setInput("");
  setLoading(true);
  setLastSources([]);

  try {
    // ✅ Send ChatGPT-style thread (strip meta)
    const thread = nextMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: thread,          // ✅ key change
        userType,
        conversationId,
        sessionId,
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

    const sources = Array.isArray(data?.sourcesUsed) ? data!.sourcesUsed! : [];

    setLastSources(sources);
    if (data?.sessionId) setSessionId(data.sessionId);

    const answerText = (data?.answer ?? "").toString().trim();

    if (answerText) {
      setMessages((m) => [...m, { role: "assistant", content: answerText }]);
    } else {
      // ✅ NEW: never allow “no assistant bubble”
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content:
            "I didn’t get a response back from the assistant. Try again — and if it keeps happening, tell me what you’re securing + membrane type so I can recommend the right solution.",
        },
      ]);
    }


    // auto-title
    const current = conversations.find((c) => c.id === conversationId);
    const currentTitle = (current?.title || "").trim();
    if (!currentTitle || currentTitle.toLowerCase() === "new chat") {
      const nextTitle = text.slice(0, 48).trim() || "New chat";
      renameConversation(conversationId, nextTitle);
    }

    if (data?.conversationId && data.conversationId !== conversationId) {
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

  // Shared UI tokens (Anchor dashboard scheme)
  const PANEL = "bg-white";
  const PANEL_HEADER = "border-b border-black/10 px-4 py-3 shrink-0";
  const PANEL_BODY = "flex-1 min-h-0";
  const SOFT_SCROLL = "overflow-y-auto [scrollbar-width:thin]";

  const MUTED = "text-[#76777B]";

  return (
    <main className="h-[100vh] bg-white sm:bg-[#F6F7F8] text-black flex flex-col overflow-hidden">
      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-[#047835] pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          {/* Left: brand + menu */}
          <div className="flex min-w-0 items-center gap-3">
            {/* Brand */}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="h-9 w-9 shrink-0 rounded-md border border-white/20 bg-white/10 flex items-center justify-center hover:bg-white/15 transition"
              title="Refresh"
              aria-label="Refresh"
            >
              <img src="/anchorp.svg" alt="Anchor Products" className="h-10 w-auto" />
            </button>

            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-semibold tracking-wide text-white">
                Anchor Sales Co-Pilot
              </div>
              <div className="truncate text-[12px] text-white/80">Docs • Specs • Install • Downloads</div>
            </div>
          </div>

          {/* Right: actions */}
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="h-9 rounded-md border border-white/20 bg-white/10 px-3 text-[12px] font-semibold text-white hover:bg-white/15 transition"
              title="Refresh chat"
              aria-label="Refresh chat"
            >
              Refresh
            </button>
            <Link
              href="/dashboard"
              className="hidden md:inline-flex h-9 items-center rounded-md border border-white/20 bg-white/10 px-3 text-[12px] font-semibold text-white hover:bg-white/15 transition"
              title="Return to Dashboard"
            >
              Dashboard
            </Link>

            <Link
              href="/dashboard"
              className="sm:hidden h-9 min-w-[96px] inline-flex items-center justify-center rounded-md border border-white/20 bg-white/10 px-3 text-[12px] font-semibold text-white hover:bg-white/15 transition"
              title="Return to Dashboard"
            >
              Dashboard
            </Link>

          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="mx-auto flex h-full max-w-6xl flex-col px-0 py-0 sm:px-4 sm:py-4">
          <div className="flex flex-1 flex-col gap-0 sm:gap-4 min-h-0">
            {/* Chat panel */}
            <section
              className={[
                PANEL,
                "flex flex-1 flex-col min-h-0",
                "overflow-hidden",
                "rounded-none border-0 shadow-none",
                "sm:rounded-3xl sm:border sm:border-black/10 sm:shadow-sm",
              ].join(" ")}
            >

              {/* Messages */}
              <div className={`${PANEL_BODY} ${SOFT_SCROLL} px-4 py-4 bg-transparent`}>
                <div className="space-y-3">
                  {messages.map((m, idx) => (
                    <div
                      key={idx}
                      className={[
                        "max-w-[92%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed",
                        m.role === "user"
                          ? "ml-auto bg-[#9CE2BB] border border-black/10"
                          : "bg-white border border-black/10",
                      ].join(" ")}
                    >
                      {renderMessageContent(m.content)}
                    </div>
                  ))}

                  {/* Feedback (opt-in) */}
                  {canShowFeedback && (
                    <div className="max-w-[92%]">
                      <div className={`mt-2 flex items-center gap-2 text-[12px] ${MUTED}`}>
                        <span>Was that correct?</span>

                        <button
                          type="button"
                          onClick={() => setShowFeedback(false)}
                          className={[
                            "rounded-md border px-2 py-1 transition",
                            !showFeedback
                              ? "border-[#047835]/35 bg-[#9CE2BB] text-[#11500F]"
                              : "border-black/10 bg-white hover:bg-black/[0.03] text-black/70",
                          ].join(" ")}
                        >
                          Yes
                        </button>

                        <button
                          type="button"
                          onClick={() => setShowFeedback(true)}
                          className={[
                            "rounded-md border px-2 py-1 transition",
                            showFeedback
                              ? "border-red-300/40 bg-red-50 text-red-700"
                              : "border-black/10 bg-white hover:bg-black/[0.03] text-black/70",
                          ].join(" ")}
                        >
                          Wrong / Needs correction
                        </button>

                        {showFeedback && (
                          <button
                            type="button"
                            onClick={() => setShowFeedback(false)}
                            className="ml-auto rounded-md border border-black/10 bg-white px-2 py-1 text-black/70 hover:bg-black/[0.03] transition"
                          >
                            Hide
                          </button>
                        )}
                      </div>

                      {showFeedback && (
                        <div className="mt-2">
                          <SourcesFeedback
                            sources={lastSources}
                            sessionId={sessionId}
                            conversationId={conversationId}
                            userMessage={lastUserMessage}
                            assistantMessage={lastAssistantMessage}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {(historyLoading || loading) && (
                    <div className="max-w-[92%] rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-black/80">
                      {historyLoading ? "Loading chat…" : "Thinking…"}
                    </div>
                  )}

                  <div ref={scrollRef} />
                </div>
              </div>

              {/* Composer */}
              <div className="mt-auto border-t border-black/10 shrink-0 bg-white pb-[env(safe-area-inset-bottom)]">
                <div className="p-3">
                  <div className="flex w-full gap-2">
                    <input
                      className="min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-3 py-3 text-sm outline-none placeholder:text-[#76777B] focus:border-[#047835] disabled:opacity-60"
                      placeholder={inputDisabled ? "Loading your chat…" : "Type your question…"}
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
                      className="shrink-0 rounded-xl bg-[#047835] px-5 py-3 text-sm font-semibold text-white shadow hover:bg-[#11500F] disabled:opacity-50"
                      type="button"
                    >
                      Send
                    </button>
                  </div>

                  {!profileLoading && (
                    <div className="mt-2 text-[11px] text-black/50">
                      Access mode: <span className="text-black/70">{userType}</span>
                    </div>
                  )}
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
