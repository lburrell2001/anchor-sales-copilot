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
  sessionId?: string;
  answer?: string; // can be empty for docs-only pulls
  foldersUsed?: string[];
  recommendedDocs?: RecommendedDoc[];
  sourcesUsed?: SourceUsed[];
  hasMoreDocs?: boolean; // optional (if your /api/chat returns it)
  error?: string;
};

type MsgMeta = {
  type?: "docs_only" | "assistant_with_docs";
  recommendedDocs?: RecommendedDoc[];
  foldersUsed?: string[];
};

type Msg = { role: "user" | "assistant"; content: string; meta?: MsgMeta | null };


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
  meta?: MsgMeta | null;
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
  const [convoLoading, setConvoLoading] = useState(true);

  // UI
  const [historyLoading, setHistoryLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // chat
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([DEFAULT_GREETING]);
  const [loading, setLoading] = useState(false);

  // ✅ show "See docs" only on user messages that actually yielded docs
  const [docsReadyFor, setDocsReadyFor] = useState<Record<number, boolean>>({});

  // feedback (opt-in)
  const [showFeedback, setShowFeedback] = useState(false);

  // right panel
  const [lastDocs, setLastDocs] = useState<RecommendedDoc[]>([]);
  type RecentDoc = {
    doc_title: string | null;
    doc_type: string | null;
    doc_path: string;
    doc_url: string | null;
    created_at: string;
  };

  const [recentDocs, setRecentDocs] = useState<RecentDoc[]>([]);
  const [lastFolders, setLastFolders] = useState<string[]>([]);
  const [lastSources, setLastSources] = useState<SourceUsed[]>([]);

  // docs paging (infinite scroll)
  const [docsPage, setDocsPage] = useState(0);
  const [docsHasMore, setDocsHasMore] = useState(false);
  const [docsLoadingMore, setDocsLoadingMore] = useState(false);
  const [lastDocsQuery, setLastDocsQuery] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const docsScrollRef = useRef<HTMLDivElement | null>(null);

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
    // Only show "Was that correct?" after a real assistant answer (not the greeting)
    if (!lastAssistantMessage) return false;
    if (isDefaultGreeting) return false;
    return true;
  }, [isDefaultGreeting, lastAssistantMessage]);

  // ✅ Docs-only pull for a specific user message index
  async function seeDocsFor(idx: number, text: string) {
    if (!text) return;
    if (!conversationId) return;

    // reset docs paging for this query
    setDocsPage(0);
    setDocsHasMore(false);
    setDocsLoadingMore(false);
    setLastDocsQuery(text);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "docs",
          message: text,
          userType,
          conversationId,
          sessionId,
        }),
      });

      const data = await readJsonSafely<ChatResponse>(res);
      if (!res.ok) return;

      const docs = Array.isArray(data?.recommendedDocs) ? data.recommendedDocs : [];
      const folders = Array.isArray(data?.foldersUsed) ? data.foldersUsed : [];

      setLastDocs(docs);
      setLastFolders(folders);

      // ✅ only mark this bubble if docs actually came back
      if (docs.length > 0) {
        setDocsReadyFor((prev) => ({ ...prev, [idx]: true }));
      }

      // use server signal if present, else fallback
      if (typeof data?.hasMoreDocs === "boolean") setDocsHasMore(data.hasMoreDocs);
      else setDocsHasMore(docs.length > 0);

      requestAnimationFrame(() => {
        docsScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      });
    } catch {
      // ignore – docs are optional
    }
  }

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
  // Build display messages (skip empty assistant bubbles),
  // but keep docs meta by attaching it to the previous user message.
  const display: Array<{ role: "user" | "assistant"; content: string; meta?: any }> = [];
  const nextDocsReady: Record<number, boolean> = {};

  let lastUserDisplayIndex: number | null = null;

  for (const r of rows as any[]) {
    const role = r.role as "user" | "assistant";
    const content = (r.content ?? "").toString();
    const meta = r.meta ?? null;

    // ✅ If this is a docs-only assistant row (empty content), don't render it
    // but attach its meta to the previous user message.
    if (role === "assistant" && !content.trim()) {
      const docs = meta?.recommendedDocs;
      const folders = meta?.foldersUsed;

      if (
        lastUserDisplayIndex !== null &&
        (Array.isArray(docs) && docs.length > 0)
      ) {
        // attach docs meta to the last user bubble
        display[lastUserDisplayIndex].meta = { ...(display[lastUserDisplayIndex].meta || {}), ...meta };

        // mark that user bubble as having docs
        nextDocsReady[lastUserDisplayIndex] = true;

        // also restore right panel to last seen docs
        setLastDocs(docs);
        setLastFolders(Array.isArray(folders) ? folders : []);
      }

      continue; // skip rendering this blank assistant bubble
    }

    // Normal message bubble
    const idx = display.length;
    display.push({ role, content, meta });

    if (role === "user") lastUserDisplayIndex = idx;

    // If an assistant answer has docs meta, mark the previous user bubble
    if (role === "assistant") {
      const docs = meta?.recommendedDocs;
      if (lastUserDisplayIndex !== null && Array.isArray(docs) && docs.length > 0) {
        nextDocsReady[lastUserDisplayIndex] = true;
      }
    }
  }

  setMessages(display as any);
  setDocsReadyFor(nextDocsReady);
} else {
  setMessages([DEFAULT_GREETING] as any);
  setDocsReadyFor({});
}



        // clear per-response panels when switching history
        setLastSources([]);
        setLastDocs([]);
        setLastFolders([]);
        setShowFeedback(false);

        // reset docs paging
        setDocsPage(0);
        setDocsHasMore(false);
        setDocsLoadingMore(false);
        setLastDocsQuery(null);
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
      setShowFeedback(false);

      // ✅ reset "See docs" state
      setDocsReadyFor({});

      // reset docs paging
      setDocsPage(0);
      setDocsHasMore(false);
      setDocsLoadingMore(false);
      setLastDocsQuery(null);

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
        setShowFeedback(false);

        // ✅ reset "See docs" state
        setDocsReadyFor({});

        // reset docs paging
        setDocsPage(0);
        setDocsHasMore(false);
        setDocsLoadingMore(false);
        setLastDocsQuery(null);

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

  useEffect(() => {
    if (!userId) return;

    (async () => {
      try {
        const res = await fetch("/api/recent-docs", { method: "GET", cache: "no-store" });
        const data = await readJsonSafely<any>(res);
        if (!res.ok) return;
        setRecentDocs(Array.isArray(data?.docs) ? data.docs : []);
      } catch {
        // ignore
      }
    })();
  }, [userId]);

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
    setShowFeedback(false);

    // ✅ reset "See docs" state
    setDocsReadyFor({});

    // reset docs paging
    setDocsPage(0);
    setDocsHasMore(false);
    setDocsLoadingMore(false);
    setLastDocsQuery(null);

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

  const hasDocs = lastDocs.length > 0;

  const roleLabel = useMemo(() => {
    if (role === "anchor_rep") return "Anchor Rep";
    if (role === "external_rep") return "External Rep";
    if (role === "admin") return "Admin";
    return "no role";
  }, [role]);

  // infinite load for docs panel
  async function loadMoreDocs() {
    if (docsLoadingMore) return;
    if (!docsHasMore) return;
    if (!lastDocsQuery) return;

    setDocsLoadingMore(true);
    try {
      const nextPage = docsPage + 1;

      const res = await fetch(
        `/api/docs?q=${encodeURIComponent(lastDocsQuery)}&limit=20&page=${nextPage}`,
        { method: "GET", cache: "no-store" }
      );

      const data = await readJsonSafely<any>(res);
      if (!res.ok) return;

      const nextDocs: RecommendedDoc[] = Array.isArray(data?.docs) ? data.docs : [];
      const hasMore = !!data?.hasMore;

      setLastDocs((prev) => {
        const seen = new Set(prev.map((d) => d.path));
        const merged = [...prev];
        for (const d of nextDocs) {
          if (d?.path && !seen.has(d.path)) merged.push(d);
        }
        return merged;
      });

      setDocsPage(nextPage);
      setDocsHasMore(hasMore);
    } finally {
      setDocsLoadingMore(false);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    if (!userId || !conversationId) return;
    if (profileLoading || historyLoading) return;

    // UX: hide feedback whenever a new message is sent
    setShowFeedback(false);

    // ✅ capture the index this user message will occupy
    const userMsgIndex = messages.length;

    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setLoading(true);
    setLastSources([]);

    // reset docs paging for a new query
    setDocsPage(0);
    setDocsHasMore(false);
    setDocsLoadingMore(false);
    setLastDocsQuery(text);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
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

      const docs = Array.isArray(data?.recommendedDocs) ? data!.recommendedDocs! : [];
      const folders = Array.isArray(data?.foldersUsed) ? data!.foldersUsed! : [];
      const sources = Array.isArray(data?.sourcesUsed) ? data!.sourcesUsed! : [];

      setLastDocs(docs);
      setLastFolders(folders);
      setLastSources(sources);

      // ✅ only show the "See docs" button if this message actually returned docs
      if (docs.length > 0) {
        setDocsReadyFor((prev) => ({ ...prev, [userMsgIndex]: true }));
      }

      // Better: use server signal if available
      if (typeof data?.hasMoreDocs === "boolean") {
        setDocsHasMore(data.hasMoreDocs);
      } else {
        // fallback: assume more if we got any docs (loadMoreDocs will correct once /api/docs returns hasMore)
        setDocsHasMore(docs.length > 0);
      }

      // snap docs panel to top on new results
      requestAnimationFrame(() => {
        docsScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      });

      if (data?.sessionId) setSessionId(data.sessionId);

      // Only append assistant message if present
      const answerText = (data?.answer ?? "").toString().trim();
      if (answerText) {
        setMessages((m) => [...m, { role: "assistant", content: answerText }]);
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

  // Shared UI tokens (ChatGPT-ish)
  const PANEL =
    "rounded-2xl border border-white/10 bg-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur";
  const PANEL_HEADER = "border-b border-white/10 px-4 py-3 shrink-0";
  const PANEL_BODY = "flex-1 min-h-0";
  const SOFT_SCROLL = "overflow-y-auto [scrollbar-width:thin]";

  return (
    <main className="h-[100svh] anchor-app-bg text-white flex flex-col overflow-hidden">
      {/* Top bar (ChatGPT-like) */}
      <header className="sticky top-0 z-30 anchor-topbar shrink-0">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* Mobile menu button */}
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              className="md:hidden h-9 rounded-md border border-white/10 bg-black/40 px-3 text-[12px] font-semibold text-white/80 hover:bg-black/60 transition"
            >
              Menu
            </button>

            {/* Brand */}
            <button
              onClick={() => window.location.reload()}
              className="h-9 w-9 rounded-md bg-black/60 border border-white/10 flex items-center justify-center hover:bg-black/80 transition shrink-0"
              type="button"
              title="Refresh"
              aria-label="Refresh"
            >
              <img src="/anchorp.svg" alt="Anchor Products" className="h-10 w-auto" />
            </button>

            <div className="leading-tight min-w-0">
              <div className="text-sm font-semibold tracking-wide truncate">
                Anchor Sales Co-Pilot
              </div>
              <div className="text-[12px] text-white/60 truncate">Docs • Specs • Install • Downloads</div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!profileLoading && role === "admin" ? (
              <button
                type="button"
                onClick={goAdmin}
                className="hidden sm:inline-flex h-9 items-center rounded-md border border-white/10 bg-black/40 px-3 text-[12px] font-semibold text-white/80 hover:bg-black/60 transition"
                title="Open admin dashboard"
              >
                Admin
              </button>
            ) : (
              <div className="hidden sm:inline-flex rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-white/70">
                {profileLoading ? "…" : roleLabel}
              </div>
            )}

            <button
              type="button"
              onClick={newChat}
              className="h-9 rounded-md border border-white/10 bg-black/40 px-3 text-[12px] font-semibold text-white/80 hover:bg-black/60 transition"
              title="Start a new chat"
            >
              New
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
      <div className="flex-1 min-h-0">
        <div className="mx-auto h-full max-w-6xl px-4 py-4">
          {/* Desktop: 3 panels same height. Mobile: chat only; sidebar via menu; docs only when hasDocs */}
          <div className="grid h-full grid-cols-1 gap-4 md:grid-cols-[280px_1fr_320px]">
            {/* Desktop sidebar */}
            <aside className={`hidden md:flex ${PANEL} flex-col min-h-0`}>
              {/* Scroll only when overflow */}
              <div className={`${PANEL_BODY} ${SOFT_SCROLL} bg-transparent`}>
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
            </aside>

            {/* Mobile sidebar drawer */}
            {sidebarOpen && (
              <div className="md:hidden fixed inset-0 z-40">
                <div className="absolute inset-0 bg-black/60" onClick={() => setSidebarOpen(false)} />
                <aside className={`absolute left-3 right-3 top-16 bottom-3 ${PANEL} flex flex-col min-h-0`}>
                  <div className={PANEL_HEADER}>
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold">Chats</div>
                      <button
                        type="button"
                        onClick={() => setSidebarOpen(false)}
                        className="rounded-md border border-white/10 bg-black/35 px-3 py-1 text-[12px] text-white/80 hover:bg-black/55 transition"
                      >
                        Close
                      </button>
                    </div>
                  </div>

                  <div className={`${PANEL_BODY} ${SOFT_SCROLL} p-2`}>
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
              </div>
            )}

            {/* Chat panel */}
            <section className={`${PANEL} flex flex-col h-full min-h-0`}>
              <div className={PANEL_HEADER}>
                <div className="text-xs text-white/70">
                  Ask like: “U2400 EPDM install manual + data sheet” or “HVAC solution docs”
                </div>
              </div>

              {/* Messages (scroll only if overflow) */}
              <div className={`${PANEL_BODY} ${SOFT_SCROLL} px-4 py-4 bg-transparent`}>
                <div className="space-y-3">
                  {messages.map((m, idx) => (
                    <div
                      key={idx}
                      className={[
                        "max-w-[92%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed",
                        m.role === "user"
                          ? "ml-auto bg-emerald-400/15 border border-emerald-300/15"
                          : "bg-black/40 border border-white/10",
                      ].join(" ")}
                    >
                      <div>{m.content}</div>

                      {/* ✅ User message actions (only show if this message yielded docs) */}
                      {m.role === "user" && !!docsReadyFor[idx] && (
                        <div className="mt-2 flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => seeDocsFor(idx, m.content)}
                            className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-white/75 hover:bg-black/45 transition"
                            title="Show documents for this message"
                          >
                            See docs
                          </button>
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Feedback is opt-in and only after real assistant answers */}
                  {canShowFeedback && (
                    <div className="max-w-[92%]">
                      <div className="mt-2 flex items-center gap-2 text-[12px] text-white/60">
                        <span>Was that correct?</span>

                        <button
                          type="button"
                          onClick={() => setShowFeedback(false)}
                          className={[
                            "rounded-md border px-2 py-1 transition",
                            !showFeedback
                              ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-100"
                              : "border-white/10 bg-black/30 hover:bg-black/40 text-white/70",
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
                              ? "border-red-300/25 bg-red-400/10 text-red-100"
                              : "border-white/10 bg-black/30 hover:bg-black/40 text-white/70",
                          ].join(" ")}
                        >
                          Wrong / Needs correction
                        </button>

                        {showFeedback && (
                          <button
                            type="button"
                            onClick={() => setShowFeedback(false)}
                            className="ml-auto rounded-md border border-white/10 bg-black/30 px-2 py-1 text-white/70 hover:bg-black/40 transition"
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
                    <div className="max-w-[92%] rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white/80">
                      {historyLoading ? "Loading chat…" : "Thinking…"}
                    </div>
                  )}

                  <div ref={scrollRef} />
                </div>
              </div>

              {/* Composer (ChatGPT-ish) */}
              <div className="border-t border-white/10 shrink-0">
                <div className="px-3 pt-3">
                  <div className="max-h-[92px] overflow-y-auto overflow-x-hidden pb-2 pr-1">
                    <div className="flex flex-wrap gap-2">
                      {QUICK_PICKS.map((label) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => pushQuickPick(label)}
                          className="rounded-full border border-emerald-300/25 bg-emerald-400/10 px-3 py-1 text-[12px] text-emerald-100 hover:bg-emerald-400/15 disabled:opacity-60 transition"
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
                      className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-3 text-sm outline-none placeholder:text-white/40 focus:border-emerald-300/30 disabled:opacity-60"
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
                      className="shrink-0 rounded-xl bg-gradient-to-r from-emerald-400 to-lime-400 px-5 py-3 text-sm font-semibold text-black shadow disabled:opacity-50"
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

            {/* Docs panel:
                - Desktop: always there (same size)
                - Mobile: only render when hasDocs
            */}
            <aside
              className={[
                PANEL,
                "flex flex-col h-full min-h-0",
                hasDocs ? "block" : "hidden", // hide on mobile unless there are docs
                "md:flex md:block", // always show on desktop
              ].join(" ")}
            >
              <div className={PANEL_HEADER}>
                <div className="text-sm font-semibold">Recommended documents</div>
                <div className="mt-1 text-[12px] text-white/60">Tap to download/share</div>
              </div>

              <div
                ref={docsScrollRef}
                className={`${PANEL_BODY} ${SOFT_SCROLL} p-3 bg-transparent`}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 140;
                  if (nearBottom) loadMoreDocs();
                }}
              >
                {/* If no docs, show empty state (desktop only; on mobile panel is hidden anyway) */}
                {!hasDocs ? (
                  <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-white/70">
                    No docs yet. Ask a question to pull files from Storage.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Recent docs */}
                    {recentDocs.length > 0 && (
                      <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                        <div className="text-[11px] font-semibold text-white/70">Recent docs you opened</div>
                        <div className="mt-2 space-y-1">
                          {recentDocs.map((r) => (
                            <button
                              key={`${r.doc_path}-${r.created_at}`}
                              type="button"
                              onClick={() =>
                                r.doc_url && window.open(r.doc_url, "_blank", "noopener,noreferrer")
                              }
                              className="w-full text-left rounded-lg border border-white/10 bg-black/30 px-3 py-2 hover:bg-black/45 transition"
                            >
                              <div className="truncate text-[12px] font-semibold text-white/85">
                                {r.doc_title || r.doc_path}
                              </div>
                              <div className="text-[11px] text-white/55 truncate">
                                {r.doc_type || "doc"} • {r.doc_path}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Recommended docs */}
                    <div className="space-y-2">
                      {lastDocs.map((d, i) => (
                        <button
                          key={`${d.path}-${i}`}
                          type="button"
                          onClick={() => {
                            if (!d.url) return;

                            navigator.sendBeacon(
                              "/api/doc-event",
                              JSON.stringify({ conversationId, doc: d })
                            );

                            window.open(d.url, "_blank", "noopener,noreferrer");
                          }}
                          className={[
                            "w-full text-left rounded-xl border px-3 py-2 transition",
                            d.url
                              ? "border-white/10 bg-black/35 hover:border-emerald-300/25 hover:bg-black/50"
                              : "border-white/10 bg-black/20 opacity-60 cursor-not-allowed",
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
                        </button>
                      ))}
                    </div>

                    {(docsLoadingMore || docsHasMore) && (
                      <div className="mt-1 rounded-xl border border-white/10 bg-black/30 p-3 text-[12px] text-white/70">
                        {docsLoadingMore ? "Loading more…" : "Scroll for more…"}
                      </div>
                    )}

                    {!docsHasMore && lastDocs.length > 0 && (
                      <div className="text-[11px] text-white/45">End of results.</div>
                    )}

                    {lastFolders?.length ? (
                      <div className="rounded-xl border border-white/10 bg-black/30 p-3">
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
                )}
              </div>
            </aside>
          </div>
        </div>
      </div>
    </main>
  );
}
