// src/app/assets/page.tsx
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function AssetsPage() {
  return (
    <main className="min-h-dvh bg-[#F6F7F8] text-black">
      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-[#047835] pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-md bg-white/10 border border-white/20 flex items-center justify-center shrink-0">
              <img src="/anchorp.svg" alt="Anchor Products" className="h-10 w-auto" />
            </div>

            <div className="leading-tight min-w-0">
              <div className="text-sm font-semibold tracking-wide truncate text-white">
                Asset Management
              </div>
              <div className="text-[12px] text-white/80 truncate">
                Product tackle boxes • Files • Links
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/dashboard"
              className="h-9 inline-flex items-center rounded-md border border-white/20 bg-white/10 px-3 text-[12px] font-semibold text-white hover:bg-white/15 transition"
              title="Back to Dashboard"
            >
              Dashboard
            </Link>

            
          </div>
        </div>
      </header>

      {/* Page body */}
      <div className="mx-auto max-w-5xl px-5 py-6">
        {/* Page header card */}
        <div className="mb-4 rounded-3xl border border-black/10 bg-white p-5 shadow-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Asset Management</h1>
          <p className="mt-1 text-sm text-[#76777B]">
            This is where product “tackle boxes” will live.
          </p>

          
        </div>

        {/* Main content */}
        <section className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-black">Next step: connect Supabase tables</div>
              <div className="mt-1 text-sm text-[#76777B]">
                Build product pages + “tackle box” sections for every file type.
              </div>
            </div>

            
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-black/10 bg-[#F6F7F8] p-4">
              <div className="text-[12px] font-semibold text-[#047835]">products</div>
              <div className="mt-1 text-[12px] text-[#76777B]">id, name, sku, series, active</div>
              <div className="mt-3 text-sm text-black/75">
                One row per product. This powers the browse/search list and product detail pages.
              </div>
            </div>

            <div className="rounded-2xl border border-black/10 bg-[#F6F7F8] p-4">
              <div className="text-[12px] font-semibold text-[#047835]">assets</div>
              <div className="mt-1 text-[12px] text-[#76777B]">id, product_id, title, type, path, created_at</div>
              <div className="mt-3 text-sm text-black/75">
                One row per file/link. “type” can match your doc types (sales_sheet, install_manual, cad_dwg, etc.).
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-black/10 bg-[#9CE2BB] p-4">
            <div className="text-sm font-semibold text-[#11500F]">Tackle box layout</div>
            <div className="mt-1 text-sm text-[#11500F]/90">
              Tabs for: Sales Sheet, Data Sheet, Install Manual, Install Video, CAD (DWG/STEP), Drawings,
              Images, Renders, and Other.
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Link
              href="/chat"
              className="rounded-2xl border border-black/10 bg-white p-4 hover:bg-black/[0.03] transition"
            >
              <div className="text-sm font-semibold text-black">Use Copilot</div>
              <div className="mt-1 text-sm text-[#76777B]">
                Ask questions and pull install docs fast.
              </div>
              <div className="mt-3 inline-flex items-center rounded-xl bg-[#047835] px-3 py-2 text-[12px] font-semibold text-white">
                Open Copilot →
              </div>
            </Link>

            <Link
              href="/dashboard"
              className="rounded-2xl border border-black/10 bg-white p-4 hover:bg-black/[0.03] transition"
            >
              <div className="text-sm font-semibold text-black">Back to Dashboard</div>
              <div className="mt-1 text-sm text-[#76777B]">
                Switch between Copilot and Asset Management.
              </div>
              <div className="mt-3 inline-flex items-center rounded-xl border border-black/10 bg-white px-3 py-2 text-[12px] font-semibold text-[#047835]">
                Open Dashboard →
              </div>
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
