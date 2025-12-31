"use client";

import { useState } from "react";

export type SourceUsed = {
  chunkId: string;
  documentId: string;
  title: string | null;
  similarity: number;
  content: string;
};

type Props = {
  sources: SourceUsed[];
  sessionId?: string | null;
  conversationId?: string | null;
  userMessage?: string | null;
  assistantMessage?: string | null;
};

type SentState = Record<string, boolean>;
type TextState = Record<string, string>;

export default function SourcesFeedback({
  sources,
  sessionId,
  conversationId,
  userMessage,
  assistantMessage,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState<TextState>({});
  const [correction, setCorrection] = useState<TextState>({});
  const [sent, setSent] = useState<SentState>({});
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const hasSources = Array.isArray(sources) && sources.length > 0;

  async function postJson(url: string, payload: any) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const txt = await res.text();
    let data: any = null;
    try {
      data = txt ? JSON.parse(txt) : null;
    } catch {
      data = null;
    }

    if (!res.ok) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    return data;
  }

  function sessionReady() {
    return !!sessionId && !!conversationId;
  }

  async function sendThumb(s: SourceUsed, up: boolean) {
    setError(null);

    if (!sessionReady()) {
      setError("Session not ready yet. Send a message first, then submit feedback.");
      return;
    }

    const rating = up ? 5 : 1;

    setBusyId(s.chunkId);
    try {
      await postJson("/api/feedback", {
        sessionId,
        conversationId,
        userMessage,
        assistantMessage,
        documentId: s.documentId,
        chunkId: s.chunkId,
        rating,
        note: null,
      });

      setSent((p) => ({ ...p, [s.chunkId]: true }));
      setOpenId(null);
    } catch (e: any) {
      setError(e?.message || "Failed to save feedback.");
    } finally {
      setBusyId(null);
    }
  }

  async function submitDownvoteWithCorrection(s: SourceUsed) {
    setError(null);

    if (!sessionReady()) {
      setError("Session not ready yet. Send a message first, then submit feedback.");
      return;
    }

    const n = (note[s.chunkId] ?? "").trim();
    const c = (correction[s.chunkId] ?? "").trim();

    setBusyId(s.chunkId);
    try {
      // 1) always submit feedback (rating=1)
      await postJson("/api/feedback", {
        sessionId,
        conversationId,
        userMessage,
        assistantMessage,
        documentId: s.documentId,
        chunkId: s.chunkId,
        rating: 1,
        note: n || null,
      });

      // 2) if correction text provided, submit correction ticket
      if (c.length > 0) {
        await postJson("/api/corrections", {
          sessionId,
          conversationId,
          userMessage,
          assistantMessage,
          documentId: s.documentId,
          chunkId: s.chunkId,
          note: n || null,
          correction: c,
        });
      }

      setSent((p) => ({ ...p, [s.chunkId]: true }));
      setOpenId(null);
    } catch (e: any) {
      setError(e?.message || "Failed to save feedback/correction.");
    } finally {
      setBusyId(null);
    }
  }

  // ✅ NEW: allow “wrong / correction” even when no sources were returned
  async function submitNoSourcesWrong() {
    setError(null);

    if (!sessionReady()) {
      setError("Session not ready yet. Send a message first, then submit feedback.");
      return;
    }

    const key = "__no_sources__";
    const n = (note[key] ?? "").trim();
    const c = (correction[key] ?? "").trim();

    setBusyId(key);
    try {
      // feedback without chunk/document
      await postJson("/api/feedback", {
        sessionId,
        conversationId,
        userMessage,
        assistantMessage,
        documentId: null,
        chunkId: null,
        rating: 1,
        note: n || "Answer wrong — no sources returned",
      });

      // optional correction ticket without chunk/document
      if (c.length > 0) {
        await postJson("/api/corrections", {
          sessionId,
          conversationId,
          userMessage,
          assistantMessage,
          documentId: null,
          chunkId: null,
          note: n || null,
          correction: c,
        });
      }

      setSent((p) => ({ ...p, [key]: true }));
      setOpenId(null);
    } catch (e: any) {
      setError(e?.message || "Failed to save feedback/correction.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mt-3 border border-white/10 p-3 text-sm">
      <div className="mb-2 font-medium opacity-90">
        {hasSources ? "Sources used" : "Feedback"}
      </div>

      {error ? (
        <div className="mb-2 rounded border border-red-400/30 bg-red-500/10 p-2 text-[12px] text-red-100">
          {error}
        </div>
      ) : null}

      {/* ✅ NEW: fallback UI when sourcesUsed is empty */}
      {!hasSources ? (
        <div className="rounded-lg border border-white/10 bg-black/30 p-3">
          <div className="text-[12px] text-white/70">
            No sources were returned for this answer. You can still mark it wrong and leave a
            correction note.
          </div>

          {sent["__no_sources__"] ? (
            <div className="mt-2 opacity-70 text-[12px]">Saved — thanks.</div>
          ) : (
            <div className="mt-3 grid gap-2">
              <input
                className="border border-white/20 bg-transparent px-2 py-1"
                placeholder="Optional note (what was wrong?)"
                value={note["__no_sources__"] ?? ""}
                onChange={(e) =>
                  setNote((p) => ({ ...p, ["__no_sources__"]: e.target.value }))
                }
              />

              <textarea
                className="border border-white/20 bg-transparent px-2 py-1"
                rows={3}
                placeholder="What’s the correct info? (optional — creates a correction ticket)"
                value={correction["__no_sources__"] ?? ""}
                onChange={(e) =>
                  setCorrection((p) => ({ ...p, ["__no_sources__"]: e.target.value }))
                }
              />

              <div className="flex gap-2">
                <button
                  className="border border-white/20 px-2 py-1 disabled:opacity-50"
                  disabled={busyId === "__no_sources__"}
                  onClick={submitNoSourcesWrong}
                  type="button"
                  title="Mark answer wrong"
                >
                  {busyId === "__no_sources__" ? "Submitting…" : "❌ Submit feedback"}
                </button>

                <button
                  className="border border-white/20 px-2 py-1 disabled:opacity-50"
                  disabled={busyId === "__no_sources__"}
                  onClick={() => {
                    setNote((p) => ({ ...p, ["__no_sources__"]: "" }));
                    setCorrection((p) => ({ ...p, ["__no_sources__"]: "" }));
                  }}
                  type="button"
                >
                  Clear
                </button>
              </div>

              <div className="text-[11px] opacity-70">
                Submitting will save a ❌ feedback. If you added correction text, it also creates a
                correction ticket.
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {sources.map((s) => {
            const isOpen = openId === s.chunkId;
            const isSent = !!sent[s.chunkId];
            const isBusy = busyId === s.chunkId;

            return (
              <div key={s.chunkId} className="border border-white/10 p-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {s.title ?? "Untitled"}{" "}
                      <span className="opacity-60">({s.similarity.toFixed(3)})</span>
                    </div>
                    <div className="opacity-80 line-clamp-3 break-words">{s.content}</div>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    <button
                      className="border border-white/20 px-2 py-1 disabled:opacity-50"
                      disabled={isSent || isBusy}
                      onClick={() => sendThumb(s, true)}
                      title="This source was helpful/correct"
                      type="button"
                    >
                      {isBusy ? "…" : "✅"}
                    </button>

                    <button
                      className="border border-white/20 px-2 py-1 disabled:opacity-50"
                      disabled={isSent || isBusy}
                      onClick={() => setOpenId(isOpen ? null : s.chunkId)}
                      title="This source is wrong / needs correction"
                      type="button"
                    >
                      ❌
                    </button>
                  </div>
                </div>

                {isOpen && !isSent && (
                  <div className="mt-2 grid gap-2">
                    <input
                      className="border border-white/20 bg-transparent px-2 py-1"
                      placeholder="Optional note (why wrong?)"
                      value={note[s.chunkId] ?? ""}
                      onChange={(e) =>
                        setNote((p) => ({ ...p, [s.chunkId]: e.target.value }))
                      }
                    />
                    <textarea
                      className="border border-white/20 bg-transparent px-2 py-1"
                      rows={3}
                      placeholder="What’s the correct info? (optional — creates a correction ticket)"
                      value={correction[s.chunkId] ?? ""}
                      onChange={(e) =>
                        setCorrection((p) => ({ ...p, [s.chunkId]: e.target.value }))
                      }
                    />
                    <div className="flex gap-2">
                      <button
                        className="border border-white/20 px-2 py-1 disabled:opacity-50"
                        disabled={isBusy}
                        onClick={() => submitDownvoteWithCorrection(s)}
                        type="button"
                      >
                        {isBusy ? "Submitting…" : "Submit"}
                      </button>
                      <button
                        className="border border-white/20 px-2 py-1"
                        onClick={() => setOpenId(null)}
                        type="button"
                      >
                        Cancel
                      </button>
                    </div>

                    <div className="text-[11px] opacity-70">
                      Submitting will save a ❌ feedback. If you added correction text, it also
                      creates a correction ticket.
                    </div>
                  </div>
                )}

                {isSent && (
                  <div className="mt-2 opacity-70 text-[12px]">Saved — thanks.</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ✅ Tiny hint if sessionId/conversationId not set */}
      {!sessionReady() ? (
        <div className="mt-3 text-[11px] text-white/50">
          Tip: send at least one message in this chat first, then submit feedback.
        </div>
      ) : null}
    </div>
  );
}
