// src/app/dashboard/page.tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const router = useRouter();
  const supabase = supabaseBrowser();

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="min-h-[100svh] min-h-dvh bg-[#FFFFFF] text-[#000000]">
      {/* Top band (full bleed + iOS safe-area) */}
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

  {/* Optional hero text inside the header (matches your current layout) */}
  <div className="mx-auto max-w-6xl px-5 pb-6">
    <div className="mt-2 flex flex-col gap-2">
      <h1 className="text-3xl font-semibold tracking-tight text-white">Welcome back</h1>
      <p className="max-w-2xl text-sm text-white/80">
        Jump into Copilot or manage product tackle boxes. Everything stays organized,
        modern, and fast.
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
          {/* Chat */}
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

          {/* Assets */}
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
        <div className="mt-6 grid gap-5 md:grid-cols-3">
          <div className="rounded-3xl border border-black/10 bg-white p-5">
            <div className="text-sm font-semibold">Recent activity</div>
            <div className="mt-2 text-sm text-[#76777B]">
              Hook this up next: last chats, last docs opened, last assets viewed.
            </div>
          </div>

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
              <span className="h-2.5 w-2.5 rounded-full bg-[#047835]" />
              <span className="text-sm text-[#76777B]">Online</span>
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
