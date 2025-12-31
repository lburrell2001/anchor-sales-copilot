// src/app/admin/knowledge/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import AdminKnowledgeTabs from "@/app/components/admin/AdminKnowledgeTabs";

type Role = "admin" | "anchor_rep" | "external_rep";
type UserType = "internal" | "external";

type ProfileRow = {
  id: string;
  role: Role | null;
  user_type: UserType | null;
  email: string | null;
};

export default function AdminKnowledgePage() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const { data: u, error: uErr } = await supabase.auth.getUser();
        if (!alive) return;

        if (uErr) throw new Error(uErr.message);
        if (!u.user) {
          router.replace("/");
          return;
        }

        const { data: p, error: pErr } = await supabase
          .from("profiles")
          .select("id,role,user_type,email")
          .eq("id", u.user.id)
          .maybeSingle<ProfileRow>();

        if (pErr) throw new Error(pErr.message);

        const role = p?.role ?? null;

        // gate: only internal/admin can access
        if (role !== "admin" && role !== "anchor_rep") {
          router.replace("/chat");
          return;
        }

        setProfile(p ?? null);
      } catch (e: any) {
        setError(e?.message || "Failed to load profile");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [router, supabase]);

  if (loading) {
    return (
      <main className="min-h-screen anchor-app-bg text-white p-6">
        <div className="mx-auto max-w-6xl rounded-xl border border-white/10 bg-white/5 p-4">
          Loading admin knowledge…
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen anchor-app-bg text-white p-6">
        <div className="mx-auto max-w-6xl rounded-xl border border-red-400/20 bg-red-500/10 p-4">
          {error}
        </div>
      </main>
    );
  }

  if (!profile) return null;

  return (
    <main className="min-h-screen anchor-app-bg text-white">
      <header className="sticky top-0 z-30 anchor-topbar">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-wide">Knowledge Admin</div>
            <div className="text-[12px] text-white/60">
              Review feedback + corrections • Promote fixes into knowledge docs
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-white/70">
              {profile.role === "admin" ? "Admin" : "Anchor Rep"}
            </div>

            <button
              type="button"
              onClick={() => router.push("/chat")}
              className="h-9 rounded-md border border-white/10 bg-black/40 px-3 text-[12px] font-semibold text-white/80 hover:bg-black/60 transition"
            >
              Back to chat
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-4">
        <AdminKnowledgeTabs role={profile.role as Role} />
      </div>
    </main>
  );
}
