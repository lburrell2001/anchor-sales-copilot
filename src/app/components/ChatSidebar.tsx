"use client";

type ConversationRow = {
  id: string;
  title: string | null;
  updated_at: string | null;
};

export default function ChatSidebar({
  conversations,
  activeId,
  loading,
  onNewChat,
  onSelect,
}: {
  conversations: ConversationRow[];
  activeId: string | null;
  loading: boolean;
  onNewChat: () => void;
  onSelect: (id: string) => void;
}) {
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
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelect(c.id)}
                  className={[
                    "w-full text-left rounded-lg px-3 py-2 border transition",
                    isActive
                      ? "border-emerald-300/25 bg-emerald-400/10"
                      : "border-white/10 bg-black/30 hover:bg-black/45",
                  ].join(" ")}
                >
                  <div className="truncate text-sm font-semibold">
                    {c.title?.trim() || "New chat"}
                  </div>
                  <div className="text-[11px] text-white/50 truncate">{c.id}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-white/10 px-4 py-3 text-[11px] text-white/50">
        Tip: Click a chat to continue where you left off.
      </div>
    </aside>
  );
}
