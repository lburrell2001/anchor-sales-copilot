// src/app/dashboard/page.tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

export const dynamic = "force-dynamic";

type ConversationRow = {
  id: string;
  title: string | null;
  updated_at: string | null;
  created_at: string | null;
};

type RecentDoc = {
  doc_title: string | null;
  doc_type: string | null;
  doc_path: string;
  doc_url: string | null;
  created_at: string;
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

export default function DashboardPage() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [loadingRecent, setLoadingRecent] = useState(true);
  const [recentDocs, setRecentDocs] = useState<RecentDoc[]>([]);
  const [recentChats, setRecentChats] = useState<ConversationRow[]>([]);
  const [status, setStatus] = useState<"checking" | "online" | "offline">("checking");
const [statusWhen, setStatusWhen] = useState<string | null>(null);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/");
    router.refresh();
  }
  type RecentDoc = {
  doc_title: string | null;
  doc_type: string | null;
  doc_path: string;
  doc_url: string | null;
  created_at: string;
};

const [loadingRecentDocs, setLoadingRecentDocs] = useState(true);

async function openDoc(path: string) {
  try {
    const res = await fetch(`/api/doc-open?path=${encodeURIComponent(path)}`, {
      method: "GET",
      cache: "no-store",
    });

    if (res.status === 401) {
      router.replace("/");
      router.refresh();
      return;
    }

    const data = await readJsonSafely<{ url?: string; error?: string }>(res);
    const signed = data?.url;
    if (!res.ok || !signed) return;

    window.open(signed, "_blank", "noopener,noreferrer");
  } catch {
    // ignore
  }
}

useEffect(() => {
  let alive = true;

  (async () => {
    try {
      setLoadingRecentDocs(true);

      const res = await fetch("/api/recent-docs", { method: "GET", cache: "no-store" });
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;

      if (!alive) return;
      if (!res.ok) {
        setRecentDocs([]);
        return;
      }

      const docs = Array.isArray(data?.docs) ? data.docs : [];
      setRecentDocs(docs.slice(0, 5)); // ✅ last 5 only
    } catch {
      if (!alive) return;
      setRecentDocs([]);
    } finally {
      if (!alive) return;
      setLoadingRecentDocs(false);
    }
  })();

  return () => {
    alive = false;
  };
}, []);


  useEffect(() => {
  let alive = true;

  async function check() {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (!alive) return;

      setStatus(res.ok ? "online" : "offline");
      setStatusWhen(
        new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      );
    } catch {
      if (!alive) return;
      setStatus("offline");
      setStatusWhen(
        new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      );
    }
  }

  check(); // run immediately
  const t = window.setInterval(check, 30000); // every 30 seconds

  return () => {
    alive = false;
    window.clearInterval(t);
  };
}, []);

  // Recent activity: chats + docs
  useEffect(() => {
    let alive = true;

    (async () => {
      setLoadingRecent(true);
      try {
        // ensure authed
        const { data: userData } = await supabase.auth.getUser();
        if (!alive) return;

        const user = userData.user;
        if (!user) {
          router.replace("/");
          return;
        }

        // 1) recent chats (client-side Supabase query)
        const { data: chats } = await supabase
          .from("conversations")
          .select("id,title,updated_at,created_at")
          .eq("user_id", user.id)
          .is("deleted_at", null)
          .order("updated_at", { ascending: false })
          .limit(5);

        if (!alive) return;
        setRecentChats((chats || []) as ConversationRow[]);

        // 2) recent docs (reuse your existing endpoint from chat)
        try {
          const res = await fetch("/api/recent-docs", { method: "GET", cache: "no-store" });
          const data = await readJsonSafely<any>(res);
          if (!alive) return;
          if (res.ok) setRecentDocs(Array.isArray(data?.docs) ? data.docs : []);
        } catch {
          // ok if endpoint isn't available yet
          if (!alive) return;
          setRecentDocs([]);
        }
      } finally {
        if (!alive) return;
        setLoadingRecent(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [router, supabase]);

  return (
    <main className="min-h-[100svh] min-h-dvh bg-[#FFFFFF] text-[#000000]">
      {/* Sticky header (like chat) */}
      <header className="sticky top-0 z-30 bg-[#047835] pt-[env(safe-area-inset-top)]">
        <div className="mx-auto max-w-6xl px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-white/10 ring-1 ring-white/15 flex items-center justify-center">
                <img src="/anchorp.svg" alt="Anchor" className="h-10 w-auto" />
              </div>

              <div className="leading-tight">
                <div className="text-sm font-semibold tracking-wide text-white">
                  Anchor Sales Co-Pilot
                </div>
                <div className="text-[12px] text-white/80">Dashboard</div>
              </div>
            </div>

            <button
              type="button"
              onClick={signOut}
              className="h-9 min-w-[96px] inline-flex items-center justify-center rounded-md border border-white/20 bg-white/10 px-3 text-[12px] font-semibold text-white hover:bg-white/15 transition"
              title="Sign out"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Hero text inside header */}
        <div className="mx-auto max-w-6xl px-5 pb-6">
          <div className="mt-2 flex flex-col gap-2">
            <h1 className="text-3xl font-semibold tracking-tight text-white">Welcome back</h1>
            <p className="max-w-2xl text-sm text-white/80">
              Jump into Copilot or manage product tackle boxes. Everything stays organized, modern,
              and fast.
            </p>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="mx-auto max-w-6xl px-5 py-8 pb-[calc(2rem+env(safe-area-inset-bottom))]">
        {/* Quick actions row */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-[#9CE2BB] px-3 py-1 text-[12px] font-semibold text-[#11500F]">
            Internal tools
          </span>
        </div>

        {/* Main tiles */}
        <div className="grid gap-5 md:grid-cols-2">
          <Link
            href="/chat"
            className="group rounded-3xl border border-black/10 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">Chat Copilot</div>
                <div className="mt-1 text-sm text-[#76777B]">
                  Ask questions, pull docs, and get install guidance instantly.
                </div>
              </div>
              <span className="inline-flex items-center rounded-full bg-black/5 px-3 py-1 text-[12px] font-semibold text-black/70">
                AI
              </span>
            </div>

            <div className="mt-5 flex items-center justify-between">
              <div className="text-sm font-semibold text-[#047835]">
                Open Copilot{" "}
                <span className="transition group-hover:translate-x-1 inline-block">→</span>
              </div>
            </div>
          </Link>

          <Link
            href="/assets"
            className="group rounded-3xl border border-black/10 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">Asset Management</div>
                <div className="mt-1 text-sm text-[#76777B]">
                  Product tackle boxes: manuals, CAD, images, sales sheets, and more.
                </div>
              </div>
              <span className="inline-flex items-center rounded-full bg-[#9CE2BB] px-3 py-1 text-[12px] font-semibold text-[#11500F]">
                Library
              </span>
            </div>

            <div className="mt-5 flex items-center justify-between">
              <div className="text-sm font-semibold text-[#047835]">
                View Assets{" "}
                <span className="transition group-hover:translate-x-1 inline-block">→</span>
              </div>
            </div>
          </Link>
        </div>

        {/* Secondary section */}
<div className="mt-6 grid gap-5 md:grid-cols-[1fr_360px]">
  {/* Left: Recent activity (big card) */}
  <div className="rounded-3xl border border-black/10 bg-white p-5">
    <div className="flex items-center justify-between">
      <div className="text-sm font-semibold">Recent activity</div>
      
    </div>

    <div className="mt-3 space-y-4">
      {/* Recent chats */}
      <div>
        <div className="text-[11px] font-semibold text-black/70">Recent chats</div>

        {loadingRecent ? (
          <div className="mt-2 text-sm text-[#76777B]">Loading…</div>
        ) : recentChats.length === 0 ? (
          <div className="mt-2 text-sm text-[#76777B]">No chats yet.</div>
        ) : (
          <div className="mt-2 space-y-2">
            {recentChats.slice(0, 3).map((c) => (
  <Link
    key={c.id}
    href={`/chat?cid=${encodeURIComponent(c.id)}`}
    className="block rounded-2xl border border-black/10 bg-white px-3 py-2 hover:bg-black/[0.03] transition"
    title="Open chat"
  >
    <div className="truncate text-[12px] font-semibold text-black/85">
      {titleOrNew(c.title)}
    </div>
    <div className="text-[11px] text-[#76777B]">
      {formatWhen(c.updated_at || c.created_at)}
    </div>
  </Link>
))}

          </div>
        )}
      </div>

      {/* Recent docs opened */}
<div>
  <div className="text-[11px] font-semibold text-black/70">
    Recent docs opened
  </div>

  {loadingRecentDocs ? (
    <div className="mt-2 text-sm text-[#76777B]">Loading…</div>
  ) : recentDocs.length === 0 ? (
    <div className="mt-2 text-sm text-[#76777B]">No docs opened yet.</div>
  ) : (
    <div className="mt-2 space-y-2">
      {recentDocs.slice(0, 5).map((r) => (
        <button
          key={`${r.doc_path}-${r.created_at}`}
          type="button"
          onClick={() => openDoc(r.doc_path)}   // ✅ re-sign on click
          className="w-full text-left rounded-2xl border border-black/10 bg-white px-3 py-2 hover:bg-black/[0.03] transition"
          title="Open document"
        >
          <div className="truncate text-[12px] font-semibold text-black/85">
            {r.doc_title || r.doc_path}
          </div>

          <div className="text-[11px] text-[#76777B] truncate">
            {(r.doc_type || "doc")} • {r.doc_path}
          </div>
        </button>
      ))}
    </div>
  )}
</div>



      {/* Assets viewed (placeholder) */}
      <div className="rounded-2xl border border-black/10 bg-[#F6F7F8] p-3">
        <div className="text-[11px] font-semibold text-black/70">Assets viewed</div>
        <div className="mt-1 text-sm text-[#76777B]">
          Coming next (once Asset Management events are wired).
        </div>
      </div>
    </div>
  </div>

  {/* Right: stack small cards so they don’t stretch */}
  <div className="grid gap-5 self-start">
    <div className="rounded-3xl border border-black/10 bg-white p-5">
      <div className="text-sm font-semibold">Quick links</div>
      <div className="mt-3 flex flex-col gap-2 text-sm">
        <Link className="text-[#047835] hover:underline" href="/chat">
          Go to Copilot
        </Link>
        <Link className="text-[#047835] hover:underline" href="/assets">
          Open Asset Library
        </Link>
      </div>
    </div>

    <div className="rounded-3xl border border-black/10 bg-white p-5">
  <div className="text-sm font-semibold">System status</div>

  <div className="mt-2 flex items-center gap-2">
    <span
      className={[
        "h-2.5 w-2.5 rounded-full",
        status === "online"
          ? "bg-[#047835]"
          : status === "offline"
          ? "bg-red-500"
          : "bg-amber-400",
      ].join(" ")}
    />
    <span className="text-sm text-[#76777B]">
      {status === "checking"
        ? "Checking…"
        : status === "online"
        ? "Online"
        : "Offline"}
    </span>
  </div>

  {statusWhen && (
    <div className="mt-2 text-[11px] text-[#76777B]">
      Last checked: {statusWhen}
    </div>
  )}
</div>

  </div>
</div>


        <div className="mt-8 text-[12px] text-[#76777B]">
          Tip: Add a “Dashboard” button to the Chat top bar so reps can bounce between tools.
        </div>
      </div>
    </main>
  );
}
