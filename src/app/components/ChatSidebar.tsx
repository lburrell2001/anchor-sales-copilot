"use client";

import { useMemo, useState } from "react";

type ConversationRow = {
  id: string;
  title: string | null;
  updated_at: string | null;
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

export default function ChatSidebar({
  conversations,
  activeId,
  loading,
  onNewChat,
  onSelect,
  onRename,
  onDelete,
}: {
  conversations: ConversationRow[];
  activeId: string | null;
  loading: boolean;
  onNewChat: () => void;
  onSelect: (id: string) => void;
  onRename?: (id: string, title: string) => void | Promise<void>;
  onDelete?: (id: string) => void | Promise<void>;
}) {
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  const activeIndex = useMemo(
    () => conversations.findIndex((c) => c.id === activeId),
    [conversations, activeId]
  );

  function startRename(id: string, currentTitle: string) {
    setMenuOpenId(null);
    setEditingId(id);
    setDraftTitle(currentTitle);
  }

  async function commitRename(id: string) {
    const t = draftTitle.trim();
    setEditingId(null);
    if (!t) return;
    await onRename?.(id, t);
  }

  async function handleDelete(id: string) {
    setMenuOpenId(null);
    await onDelete?.(id);
  }

  return (
    <aside className="hidden md:flex h-[calc(100vh-56px)] flex-col rounded-xl border border-white/10 bg-white/5 backdrop-blur shadow-[0_0_0_1px_rgba(255,255,255,0.06)] overflow-hidden">
      <div className="border-b border-white/10 px-4 py-3 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">Chats</div>
        <button
          type="button"
          onClick={onNewChat}
          className="rounded-md border border-white/10 bg-black/35 px-3 py-1 text-[12px] text-white/80 hover:bg-black/55"
        >
          New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="p-3 text-sm text-white/60">Loading…</div>
        ) : conversations.length === 0 ? (
          <div className="p-3 text-sm text-white/60">No chats yet.</div>
        ) : (
          <div className="space-y-1">
            {conversations.map((c) => {
              const isActive = c.id === activeId;
              const isEditing = editingId === c.id;

              return (
                <div key={c.id} className="relative">
                  <button
                    type="button"
                    onClick={() => onSelect(c.id)}
                    className={[
                      "w-full text-left rounded-lg px-3 py-2 border transition pr-10",
                      isActive
                        ? "border-emerald-300/25 bg-emerald-400/10"
                        : "border-white/10 bg-black/30 hover:bg-black/45",
                    ].join(" ")}
                  >
                    {isEditing ? (
                      <div className="space-y-2">
                        <input
                          autoFocus
                          value={draftTitle}
                          onChange={(e) => setDraftTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename(c.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[12px] text-white/90 outline-none"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              commitRename(c.id);
                            }}
                            className="rounded-md border border-emerald-300/25 bg-emerald-400/10 px-2 py-1 text-[11px] text-emerald-100 hover:bg-emerald-400/15"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingId(null);
                            }}
                            className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-white/70 hover:bg-black/45"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="truncate text-sm font-semibold">
                          {titleOrNew(c.title)}
                        </div>
                        <div className="text-[11px] text-white/50 truncate">
                          {formatWhen(c.updated_at)}
                        </div>
                      </>
                    )}
                  </button>

                  {/* 3-dot menu */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId((v) => (v === c.id ? null : c.id));
                    }}
                    className="absolute right-2 top-2 h-7 w-7 rounded-md border border-white/10 bg-black/35 text-white/70 hover:bg-black/55"
                    aria-label="Chat actions"
                    title="Actions"
                  >
                    ⋯
                  </button>

                  {menuOpenId === c.id && (
                    <div className="absolute right-2 top-10 z-20 w-36 overflow-hidden rounded-lg border border-white/10 bg-[#0b0f14] shadow">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          startRename(c.id, titleOrNew(c.title));
                        }}
                        className="w-full px-3 py-2 text-left text-[12px] text-white/85 hover:bg-white/5"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(c.id);
                        }}
                        className="w-full px-3 py-2 text-left text-[12px] text-red-200 hover:bg-white/5"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-white/10 px-4 py-3 text-[11px] text-white/50">
        Tip: Click a chat to continue where you left off.
        {activeIndex >= 0 ? (
          <span className="ml-2 text-white/30">({activeIndex + 1}/{conversations.length})</span>
        ) : null}
      </div>
    </aside>
  );
}
