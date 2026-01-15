"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

type ProductSection = "solution" | "anchor" | "internal_assets";

type ProductRow = {
  id: string;
  name: string;
  sku: string | null;
  series: string | null;
  section: ProductSection;
  internal_kind: "tacklebox" | "docs_list" | "contacts_list" | null;
  active: boolean;
};

type ProfileRow = { role: string };

type FilterKey = "all" | "solution" | "anchor" | "internal_assets";

function norm(v: string | null | undefined) {
  return String(v || "").toLowerCase().trim();
}

function matchesSearch(p: ProductRow, q: string) {
  const s = norm(q);
  if (!s) return true;
  const hay = [p.name, p.sku ?? "", p.series ?? "", p.section ?? ""].join(" ").toLowerCase();
  return hay.includes(s);
}

function isInternalRole(role: string) {
  return role === "admin" || role === "anchor_rep";
}

function productHref(p: ProductRow) {
  if (p.section === "internal_assets") {
    if (p.internal_kind === "contacts_list") {
      return `/internal-assets/contacts/${encodeURIComponent(p.id)}`;
    }
    // default internal behavior
    return `/internal-assets/docs/${encodeURIComponent(p.id)}`;
  }

  // normal products
  return `/assets/${encodeURIComponent(p.id)}`;
}

/**
 * ✅ Keep filter buttons EXACTLY like before (do not compact them for mobile)
 */
function btnClass(on: boolean) {
  return [
    "rounded-full border px-4 py-2 text-[12px] font-semibold transition whitespace-nowrap",
    on
      ? "border-[#047835] bg-[#047835] text-white"
      : "border-black/10 bg-white text-black hover:bg-black/[0.03]",
  ].join(" ");
}

export default function AssetsBrowser() {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [products, setProducts] = useState<ProductRow[]>([]);
  const [counts, setCounts] = useState<Record<string, { public: number; internal: number }>>({});

  const [q, setQ] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");

  const [isInternalUser, setIsInternalUser] = useState(false);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setError(null);

      try {
        const { data: auth } = await supabase.auth.getUser();
        const user = auth.user;

        if (!user) {
          if (!alive) return;
          setError("Not signed in.");
          setProducts([]);
          setCounts({});
          setIsInternalUser(false);
          setLoading(false);
          return;
        }

        // Determine internal via profiles.role
        let internal = false;
        try {
          const { data: prof } = await supabase
            .from("profiles")
            .select("role")
            .eq("id", user.id)
            .maybeSingle();

          internal = isInternalRole((prof as ProfileRow | null)?.role || "");
        } catch {
          internal = false;
        }

        if (!alive) return;
        setIsInternalUser(internal);

        // If user is NOT internal and they land on internal_assets, bump to All
        if (!internal && filter === "internal_assets") {
          setFilter("all");
        }

        // PRODUCTS LIST
        const prodQuery = supabase
          .from("products")
          .select("id,name,sku,series,section,internal_kind,active")
          .order("name", { ascending: true });

        if (activeOnly) prodQuery.eq("active", true);

        if (filter !== "all") {
          prodQuery.eq("section", filter);
        }

        // External users should never see internal_assets products (extra safety)
        if (!internal) {
          prodQuery.neq("section", "internal_assets");
        }

        const { data: prodRows, error: prodErr } = await prodQuery;

        if (!alive) return;

        if (prodErr) {
          setError(prodErr.message);
          setProducts([]);
          setCounts({});
          setLoading(false);
          return;
        }

        const list = (prodRows || []) as ProductRow[];
        setProducts(list);

        // COUNTS
        const { data: assetRows } = await supabase.from("assets").select("product_id,visibility");
        if (!alive) return;

        const map: Record<string, { public: number; internal: number }> = {};
        for (const r of (assetRows || []) as { product_id: string; visibility: "public" | "internal" }[]) {
          if (!r.product_id) continue;
          if (!map[r.product_id]) map[r.product_id] = { public: 0, internal: 0 };
          if (r.visibility === "internal") map[r.product_id].internal += 1;
          else map[r.product_id].public += 1;
        }
        setCounts(map);

        setLoading(false);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || "Failed to load asset library.");
        setProducts([]);
        setCounts({});
        setIsInternalUser(false);
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [supabase, activeOnly, filter]);

  const filtered = useMemo(() => products.filter((p) => matchesSearch(p, q)), [products, q]);

  function countFor(id: string) {
    const c = counts[id] || { public: 0, internal: 0 };
    return {
      publicCount: c.public,
      internalCount: isInternalUser ? c.internal : 0,
    };
  }

  return (
    <section className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-black">Browse tackle boxes</div>
          <div className="mt-1 text-sm text-[#76777B]">
            Specs live inside each product tackle box (not a separate category).
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          

          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="h-10 w-full sm:w-[280px] rounded-2xl border border-black/10 bg-[#F6F7F8] px-4 text-sm outline-none focus:border-[#047835]"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap pb-1 [-webkit-overflow-scrolling:touch]">
          <button type="button" onClick={() => setFilter("all")} className={btnClass(filter === "all")}>
            All
          </button>
          <button type="button" onClick={() => setFilter("solution")} className={btnClass(filter === "solution")}>
            Solutions
          </button>
          <button type="button" onClick={() => setFilter("anchor")} className={btnClass(filter === "anchor")}>
            Anchors
          </button>

          <button
            type="button"
            onClick={() => isInternalUser && setFilter("internal_assets")}
            disabled={!isInternalUser}
            className={[
              "rounded-full border px-4 py-2 text-[12px] font-semibold transition whitespace-nowrap",
              !isInternalUser
                ? "border-black/10 bg-white text-black/30 cursor-not-allowed"
                : filter === "internal_assets"
                ? "border-[#047835] bg-[#047835] text-white"
                : "border-black/10 bg-white text-black hover:bg-black/[0.03]",
            ].join(" ")}
          >
            Internal assets
          </button>
        </div>

        <div className="flex justify-end">
          <span className="inline-flex items-center rounded-full bg-black/5 px-3 py-1 text-[12px] font-semibold text-black/70">
            {/* keep your original desktop copy; shorten only on mobile */}
            <span className="sm:hidden">Showing: Pub{isInternalUser ? " + Int" : ""}</span>
            <span className="hidden sm:inline">Showing: Public{isInternalUser ? " + Internal" : ""}</span>
          </span>
        </div>
      </div>

      <div className="mt-4">
        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        ) : loading ? (
          <div className="rounded-2xl border border-black/10 bg-[#F6F7F8] p-4 text-sm text-black/60">
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-black/10 bg-[#F6F7F8] p-4 text-sm text-black/60">
            No products found.
          </div>
        ) : (
          <div className="grid gap-3">
            {filtered.map((p) => {
              const c = countFor(p.id);

              return (
                <Link
  key={p.id}
  href={productHref(p)}
  title="Open tackle box"
  className="block w-full overflow-hidden rounded-2xl border border-black/10 bg-white p-4 transition hover:bg-black/[0.03]"
>
  {/* Mobile stacks; desktop stays side-by-side */}
  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
    <div className="min-w-0">
      <div className="text-sm font-semibold text-black truncate">{p.name}</div>

      <div className="mt-1 text-[12px] text-[#76777B] truncate">
        {p.sku ? `SKU: ${p.sku}` : "No SKU"}
        {p.series ? ` • Series: ${p.series}` : ""}
        {p.section ? ` • ${p.section}` : ""}
      </div>

      {/* Count pills (your mobile-safe version) */}
      <div className="mt-2 flex flex-wrap items-center gap-2 min-w-0">
        <span className="inline-flex items-center rounded-full bg-black/5 py-1 text-[11px] font-semibold text-black/70 px-2 sm:px-3 max-w-full">
          <span className="sm:hidden whitespace-nowrap">Public {c.publicCount}</span>
          <span className="hidden sm:inline whitespace-nowrap">{c.publicCount} public</span>
        </span>

        {isInternalUser && (
          <span className="inline-flex items-center rounded-full bg-[#9CE2BB] py-1 text-[11px] font-semibold text-[#11500F] px-2 sm:px-3 max-w-full">
            <span className="sm:hidden whitespace-nowrap">Int {c.internalCount}</span>
            <span className="hidden sm:inline whitespace-nowrap">{c.internalCount} internal</span>
          </span>
        )}
      </div>
    </div>

    {/* Mobile: full width button so it can’t force overflow */}
    <div className="w-full sm:w-auto sm:shrink-0">
      <div className="inline-flex w-full items-center justify-center rounded-xl bg-[#047835] px-3 py-2 text-[12px] font-semibold text-white whitespace-nowrap sm:w-auto">
        Open →
      </div>
    </div>
  </div>
</Link>

              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
