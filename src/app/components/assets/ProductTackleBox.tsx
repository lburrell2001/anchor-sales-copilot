"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useRouter } from "next/navigation";

const GLOBAL_SPEC_PATH = "spec/anchor-products-spec-v1.docx";

/* ---------------------------------------------
   Types
--------------------------------------------- */

type ProductRow = {
  id: string;
  name: string;
  sku: string | null;
  series: string | null;
  section: string | null; // solution | anchor | internal_assets
  internal_kind: "tacklebox" | "docs_list" | "contacts_list" | null;
  active: boolean;
};

type AssetRow = {
  id: string;
  product_id: string;
  title: string | null;
  type: string | null; // document | image | video | link
  category_key: string | null;
  path: string;
  visibility: "public" | "internal";
  created_at: string;
};

type ProfileRow = { id: string; role: string };

type TabKey = "all" | "spec" | "data" | "install" | "sales" | "pics" | "other";

const TAB_DEFS: { key: TabKey; label: string; visibility?: "public" | "internal" }[] = [
  { key: "all", label: "All", visibility: "public" },
  { key: "spec", label: "Spec", visibility: "public" },
  { key: "data", label: "Data Sheet", visibility: "public" },
  { key: "install", label: "Install Guide", visibility: "public" },
  { key: "sales", label: "Sales Sheet", visibility: "public" },
  { key: "pics", label: "Pictures", visibility: "public" },
  { key: "other", label: "Other", visibility: "public" },
];

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "svg", "gif"]);

/* ---------------------------------------------
   Helpers
--------------------------------------------- */

function normalizePrefix(p: string) {
  return String(p || "").trim().replace(/^\/+|\/+$/g, "");
}

function docOpenHref(path: string, download = true) {
  const p = String(path || "").trim();
  return `/api/doc-open?path=${encodeURIComponent(p)}${download ? "&download=1" : ""}`;
}

function basename(path: string) {
  const clean = String(path || "").split("?")[0];
  return clean.split("/").pop() || clean;
}

function extOf(pathOrName: string) {
  const n = basename(pathOrName).toLowerCase();
  const m = n.match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

function titleFromPath(path: string) {
  const base = basename(path);
  return base
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function slugifyName(name: string) {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/&/g, "and")
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Defensive (your API already filters folders, but keep safe)
function isFolderLike(path: string) {
  const p = String(path || "").trim();
  if (!p) return true;
  if (p.endsWith("/")) return true;
  const b = basename(p);
  return !b.includes(".");
}

function visibilityFromPath(path: string): "public" | "internal" {
  const p = String(path || "").toLowerCase();
  if (p.includes("/internal/") || p.startsWith("internal/")) return "internal";
  return "public";
}

function typeFromPath(path: string) {
  const ext = extOf(path);
  return IMAGE_EXTS.has(ext) ? "image" : "document";
}

/* ---------------------------------------------
   Storage Routing Rules
--------------------------------------------- */

/**
 * ✅ YOUR BUCKET REALITY (based on your screenshots)
 * - Solutions are under roots like: hvac/, pipe-frame/, roof-box/, etc.
 * - Anchors are NOT under anchor/<slug>/...
 *   They are under membrane roots like:
 *   - tpo/...
 *   - pvc/...
 *   - kee/...
 *   …and inside that you have nested folders like:
 *   tpo/u-anchors/u2000/kee/tpo/ (example you showed)
 *
 * So for anchors, we generate smart candidates from:
 * - membrane root (tpo/pvc/kee)
 * - family (u-anchors)
 * - model (u2000/u2200/...)
 * - possible “leaf membrane” folder again (tpo/pvc/kee)
 * - plus legacy fallbacks
 */

/**
 * Exact product name → known folder(s)
 * (Use this for any weird one-off cases.)
 */
const SPECIAL_PREFIXES_BY_NAME: Record<string, string[]> = {
  "2 Pipe Snow Fence": ["2pipe/2pipe", "solutions/snow-retention/2pipe", "solutions/2pipe/2pipe"],
  "Snow Fence": ["2pipe/snow-fence", "solutions/snow-retention/snow-fence", "solutions/2pipe/snow-fence"],
  "HVAC Tie Down": ["solutions/hvac"],

  "Roof Mounted Box": ["solutions/roof-box"],

  "Attached Pipe Frame": ["pipe-frame/attached", "solutions/pipe-frame/attached", "attached"],
  "Existing Pipe Frame": [
    // ✅ fix your typo: existing (not exisiting)
    "pipe-frame/existing",
    "solutions/pipe-frame/existing",
    "existing",
  ],

  "Roof Mounted Guardrail": ["solutions/roof-guardrail"],
  "Wall Mounted Guardrail": ["solutions/wall-guardrail"],
  "Wall Mounted Box": ["solutions/wall-box"],

    // --- ANCHORS (exact name -> exact folder) ---
  "U2000 KEE": ["anchor/u-anchors/u2000/kee"],
  "U2000 PVC": ["anchor/u-anchors/u2000/pvc"],
  "U2000 TPO": ["anchor/u-anchors/u2000/tpo"],

  "U2200 Plate": ["anchor/u-anchors/u2200/plate"],

  "U2400 EDPM": ["anchor/u-anchors/u2400/edpm"],
  "U2400 KEE": ["anchor/u-anchors/u2400/kee"],
  "U2400 PVC": ["anchor/u-anchors/u2400/pvc"],
  "U2400 TPO": ["anchor/u-anchors/u2400/tpo"],

  "U2600 APP": ["anchor/u-anchors/u2600/app"],
  "U2600 SBS": ["anchor/u-anchors/u2600/sbs"],
  "U2600 SBS Torch": ["anchor/u-anchors/u2600/sbs-torch"],

  "U2800 Coatings": ["anchor/u-anchors/u2800/coatings"],

  "U3200 Plate": ["anchor/u-anchors/u3200/plate"],

  "U3400 EDPM": ["anchor/u-anchors/u3400/edpm"],
  "U3400 KEE": ["anchor/u-anchors/u3400/kee"],
  "U3400 PVC": ["anchor/u-anchors/u3400/pvc"],
  "U3400 TPO": ["anchor/u-anchors/u3400/tpo"],

  "U3600 APP": ["anchor/u-anchors/u3600/app"],
  "U3600 SBS": ["anchor/u-anchors/u3600/sbs"],
  "U3600 SBS Torch": ["anchor/u-anchors/u3600/sbs-torch"],

  "U3800 Coatings": ["anchor/u-anchors/u3800/coatings"],
};

/**
 * Series → possible roots (solutions)
 * Keep these minimal and true.
 */
const SERIES_ROOTS_BY_SERIES: Record<string, string[]> = {
  HVAC: ["solutions/hvac"],
  "HVAC Solutions": ["solutions/hvac"],

  "Snow Retention": ["2pipe", "solutions/snow-retention", "solutions/2pipe"],
  "Snow Retention Solutions": ["2pipe", "solutions/snow-retention", "solutions/2pipe"],
  "2 Pipe": ["2pipe", "solutions/snow-retention", "solutions/2pipe"],

    // --- ANCHORS (exact name -> exact folder) ---
  "U2000 KEE": ["anchor/u-anchors/u2000/kee"],
  "U2000 PVC": ["anchor/u-anchors/u2000/pvc"],
  "U2000 TPO": ["anchor/u-anchors/u2000/tpo"],

  "U2200 Plate": ["anchor/u-anchors/u2200/plate"],

  "U2400 EPDM": ["anchor/u-anchors/u2400/epdm"],
  "U2400 KEE": ["anchor/u-anchors/u2400/kee"],
  "U2400 PVC": ["anchor/u-anchors/u2400/pvc"],
  "U2400 TPO": ["anchor/u-anchors/u2400/tpo"],

  "U2600 APP": ["anchor/u-anchors/u2600/app"],
  "U2600 SBS": ["anchor/u-anchors/u2600/sbs"],
  "U2600 SBS Torch": ["anchor/u-anchors/u2600/sbs-torch"],

  "U2800 Coatings": ["anchor/u-anchors/u2800/coatings"],

  "U3200 Plate": ["anchor/u-anchors/u3200/plate"],

  "U3400 EPDM": ["anchor/u-anchors/u3400/epdm"],
  "U3400 KEE": ["anchor/u-anchors/u3400/kee"],
  "U3400 PVC": ["anchor/u-anchors/u3400/pvc"],
  "U3400 TPO": ["anchor/u-anchors/u3400/tpo"],

  "U3600 APP": ["anchor/u-anchors/u3600/app"],
  "U3600 SBS": ["anchor/u-anchors/u3600/sbs"],
  "U3600 SBS Torch": ["anchor/u-anchors/u3600/sbs-torch"],

  "U3800 Coatings": ["anchor/u-anchors/u3800/coatings"],
};

/* ---------------------------------------------
   Anchor routing (NEW)
--------------------------------------------- */

const MEMBRANE_ROOTS = ["tpo", "pvc", "kee"] as const;

function normalizeSeriesKey(s: string) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function detectMembrane(p: ProductRow): (typeof MEMBRANE_ROOTS)[number] | null {
  const series = normalizeSeriesKey(p.series || "");
  const name = String(p.name || "").toLowerCase();

  // prefer series if it contains it
  for (const m of MEMBRANE_ROOTS) {
    if (series.includes(m)) return m;
  }
  // fallback: detect in name
  for (const m of MEMBRANE_ROOTS) {
    if (name.includes(m)) return m;
  }
  return null;
}

function detectAnchorModelFolder(p: ProductRow): string | null {
  const name = String(p.name || "").toLowerCase();

  // matches: U-2000, U2000, u 2000, etc.
  const m = name.match(/\bu\s*[- ]?\s*(\d{4})\b/);
  if (m?.[1]) return `u${m[1]}`; // u2000
  return null;
}

function detectAnchorFamilyFolder(p: ProductRow): string | null {
  const name = String(p.name || "").toLowerCase();
  // right now your screenshot shows u-anchors. Keep it simple:
  if (name.includes("u-") || name.includes("u ")) return "u-anchors";
  if (name.includes("u anchor") || name.includes("uanchor")) return "u-anchors";
  // if you add other families later, add detection here.
  return "u-anchors";
}

/* ---------------------------------------------
   Tabs
--------------------------------------------- */

function tabFromPath(path: string): TabKey {
  const file = basename(path).toLowerCase();

  if (file === basename(GLOBAL_SPEC_PATH).toLowerCase()) return "spec";

  // standard filenames you’re using
  if (file === "data-sheet.pdf") return "data";
  if (file === "sales-sheet.pdf") return "sales";
  if (file === "install-sheet.pdf" || file === "install-manual.pdf") return "install";

  // you showed a file named product-data-sheet.pdf too
  if (file === "product-data-sheet.pdf") return "data";

  const ext = extOf(file);
  if (IMAGE_EXTS.has(ext)) return "pics";

  return "other";
}

function groupBadgeFromPath(path: string): string | null {
  const p = String(path || "").toLowerCase();
  if (p.includes("/attached/") || p.startsWith("attached/") || p.includes("pipe-frame/attached/")) return "Attached";
  if (p.includes("/existing/") || p.startsWith("existing/") || p.includes("pipe-frame/existing/")) return "Existing";
  return null;
}

/* ---------------------------------------------
   API fetch
--------------------------------------------- */

async function fetchKnowledgePaths(prefix: string) {
  const cleanPrefix = normalizePrefix(prefix);
  const res = await fetch(`/api/knowledge-list?prefix=${encodeURIComponent(cleanPrefix)}`, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `knowledge-list failed: ${res.status}`);

  const paths = (json?.paths as string[]) || [];
  return paths.filter((p) => !isFolderLike(p));
}

/* ---------------------------------------------
   Prefix probing
--------------------------------------------- */

function prefixCandidatesForProduct(p: ProductRow): string[] {
  const out: string[] = [];
  const push = (x: string) => {
    const clean = normalizePrefix(x);
    if (clean) out.push(clean);
  };

  // 1) Exact overrides
  const specials = SPECIAL_PREFIXES_BY_NAME[p.name];
  if (specials?.length) return Array.from(new Set(specials.map(normalizePrefix)));

  const slug = slugifyName(p.name);
  const seriesKey = String(p.series || "").trim();
  const section = String(p.section || "").toLowerCase().trim();

  // 2) ✅ ANCHORS: use the real bucket layout you showed
  if (section === "anchor" || section === "anchors") {
    const membrane = detectMembrane(p); // tpo|pvc|kee
    const family = detectAnchorFamilyFolder(p); // u-anchors
    const model = detectAnchorModelFolder(p); // u2000, u2200...

    // These are ordered MOST likely → least likely based on your screenshot pattern
    if (membrane && family && model) {
      // matches: tpo/u-anchors/u2000/tpo
      push(`${membrane}/${family}/${model}/${membrane}`);

      // matches: tpo/u-anchors/u2000
      push(`${membrane}/${family}/${model}`);

      // matches: u-anchors/u2000/tpo
      push(`${family}/${model}/${membrane}`);

      // matches: u-anchors/u2000
      push(`${family}/${model}`);

      // matches: tpo/u2000/tpo (if you ever remove family level)
      push(`${membrane}/${model}/${membrane}`);

      // matches: tpo/u2000
      push(`${membrane}/${model}`);
    }

    // If we ONLY know membrane, still try sane options:
    if (membrane) {
      push(`${membrane}/${slug}`);
      push(`${membrane}`);
    }

    // legacy fallbacks (if you ever move anchors under anchor/)
    push(`anchor/${slug}`);
    push(`anchor/${slug}/${slug}`);

    // last-ditch
    push(`${slug}`);

    return Array.from(new Set(out));
  }

  // 3) ✅ SOLUTIONS (existing behavior)
  const roots = SERIES_ROOTS_BY_SERIES[seriesKey] || [];
  for (const root of roots) {
    push(`${root}/${slug}`);
    push(`${root}/${slug}/${slug}`);
    push(`${root}`); // safe fallback
  }

  if (section === "solution" || section === "solutions") {
    push(`solutions/${slug}`);
    push(`solutions/${slug}/${slug}`);
  }

  if (section === "internal" || section === "internal_assets") {
    push(`internal/${slug}`);
    push(`internal/${slug}/${slug}`);
  }

  // 4) Extra safe fallbacks
  push(`${slug}`);
  push(`${slug}/${slug}`);

  return Array.from(new Set(out));
}

/* ---------------------------------------------
   Component
--------------------------------------------- */

export default function ProductTackleBox({ productId }: { productId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [product, setProduct] = useState<ProductRow | null>(null);

  const [dbAssets, setDbAssets] = useState<AssetRow[]>([]);
  const [storageAssets, setStorageAssets] = useState<AssetRow[]>([]);
  const [storagePrefix, setStoragePrefix] = useState<string>("");

  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [error, setError] = useState<string | null>(null);

  const [isInternalUser, setIsInternalUser] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [triedPrefixes, setTriedPrefixes] = useState<string[]>([]);

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    title: "",
    category_key: "data_sheet",
    type: "document",
    path: "",
    visibility: "public" as "public" | "internal",
  });
  const [formMsg, setFormMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    setTriedPrefixes([]);

    try {
      // Auth / role
      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;

      if (user) {
        try {
          const { data: prof } = await supabase.from("profiles").select("id,role").eq("id", user.id).maybeSingle();
          const role = (prof as ProfileRow | null)?.role || "";
          setIsInternalUser(role === "admin" || role === "anchor_rep");
          setIsAdmin(role === "admin");
        } catch {
          setIsInternalUser(false);
          setIsAdmin(false);
        }
      } else {
        setIsInternalUser(false);
        setIsAdmin(false);
      }

      // Product
      const { data: p, error: pErr } = await supabase
        .from("products")
        .select("id,name,sku,series,section,internal_kind,active")
        .eq("id", productId)
        .maybeSingle();

      if (pErr) {
        setError(pErr.message);
        setLoading(false);
        return;
      }
      if (!p) {
        setError("Product not found.");
        setLoading(false);
        return;
      }

      // Internal assets redirect
      if (p.section === "internal_assets") {
        const kind = (p as ProductRow).internal_kind;
        if (kind === "contacts_list") router.replace(`/internal-assets/contacts/${encodeURIComponent(p.id)}`);
        else router.replace(`/internal-assets/docs/${encodeURIComponent(p.id)}`);
        setLoading(false);
        return;
      }

      // DB assets
      const { data: a, error: aErr } = await supabase
        .from("assets")
        .select("id,product_id,title,type,category_key,path,visibility,created_at")
        .eq("product_id", productId)
        .order("created_at", { ascending: false });

      if (aErr) {
        setError(aErr.message);
        setLoading(false);
        return;
      }

      setProduct(p as ProductRow);
      setDbAssets((a as AssetRow[]) ?? []);

      // Probe storage prefixes
      const candidates = prefixCandidatesForProduct(p as ProductRow);
      setTriedPrefixes(candidates.map((x) => `${normalizePrefix(x)}/`));

      let pickedPrefix = candidates[0] || "";
      let paths: string[] = [];

      for (const candidate of candidates) {
        try {
          const got = await fetchKnowledgePaths(candidate);
          if (got.length > 0) {
            pickedPrefix = candidate;
            paths = got;
            break;
          }
        } catch {
          // ignore
        }
      }

      setStoragePrefix(normalizePrefix(pickedPrefix));

      // Build storage-derived assets
      const derived: AssetRow[] = paths.map((path) => ({
        id: `storage:${path}`,
        product_id: (p as ProductRow).id,
        title: titleFromPath(path),
        type: typeFromPath(path),
        category_key: tabFromPath(path),
        path,
        visibility: visibilityFromPath(path),
        created_at: new Date().toISOString(),
      }));

      // Always include global spec
      derived.unshift({
        id: `storage:${GLOBAL_SPEC_PATH}`,
        product_id: (p as ProductRow).id,
        title: "Anchor Products Spec (v1)",
        type: "document",
        category_key: "spec",
        path: GLOBAL_SPEC_PATH,
        visibility: "public",
        created_at: new Date().toISOString(),
      });

      // De-dupe by path
      const seen = new Set<string>();
      const deduped = derived.filter((x) => {
        const path = String(x.path || "").trim();
        if (!path) return false;
        if (seen.has(path)) return false;
        seen.add(path);
        return true;
      });

      setStorageAssets(deduped);
      setLoading(false);
    } catch (e: any) {
      setError(e?.message || "Failed to load tackle box.");
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  // Storage first, then DB extras
  const assets = useMemo(() => {
    const byPath = new Map<string, AssetRow>();
    for (const s of storageAssets) byPath.set(s.path, s);
    for (const d of dbAssets) if (!byPath.has(d.path)) byPath.set(d.path, d);
    return Array.from(byPath.values());
  }, [storageAssets, dbAssets]);

  const counts = useMemo(() => {
    const visible = isInternalUser ? assets : assets.filter((a) => a.visibility !== "internal");
    const pub = visible.filter((a) => a.visibility === "public").length;
    const internal = isInternalUser ? visible.filter((a) => a.visibility === "internal").length : 0;
    return { pub, internal };
  }, [assets, isInternalUser]);

  const filtered = useMemo(() => {
    const visible = isInternalUser ? assets : assets.filter((a) => a.visibility !== "internal");
    if (activeTab === "all") return visible;
    return visible.filter((a) => tabFromPath(a.path) === activeTab);
  }, [assets, isInternalUser, activeTab]);

  async function submitAddAsset(e: React.FormEvent) {
    e.preventDefault();
    setFormMsg(null);

    const title = form.title.trim();
    const category_key = form.category_key.trim();
    const type = form.type.trim();
    const path = form.path.trim();
    const visibility = form.visibility;

    if (!title || !category_key || !path) {
      setFormMsg("Please fill out title, category, and path.");
      return;
    }

    setAdding(true);

    const { error: insErr } = await supabase.from("assets").insert({
      product_id: productId,
      title,
      type,
      category_key,
      path,
      visibility,
    });

    if (insErr) {
      setFormMsg(insErr.message);
      setAdding(false);
      return;
    }

    setForm({ title: "", category_key: "data_sheet", type: "document", path: "", visibility: "public" });
    setFormMsg("Added!");
    await load();
    setAdding(false);
  }

  return (
    <section className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm">
      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      ) : loading ? (
        <div className="rounded-2xl border border-black/10 bg-[#F6F7F8] p-4 text-sm text-black/60">Loading tackle box…</div>
      ) : (
        <>
          {/* Header */}
          <div className="rounded-3xl border border-black/10 bg-white p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="text-[12px] font-semibold text-[#047835]">TACKLE BOX</div>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-black truncate">{product?.name}</h1>

                <div className="mt-2 text-sm text-[#76777B]">
                  {product?.sku ? `SKU: ${product.sku}` : "No SKU"}
                  {product?.series ? ` • Series: ${product.series}` : ""}
                  {product?.section ? ` • ${product.section}` : ""}
                </div>

                {storagePrefix ? (
                  <div className="mt-2 text-[12px] text-black/40">
                    Storage prefix (picked): <span className="font-mono">{storagePrefix}/</span>
                  </div>
                ) : null}

                {triedPrefixes.length ? (
                  <div className="mt-1 text-[12px] text-black/35">
                    Tried: <span className="font-mono">{triedPrefixes.join(" • ")}</span>
                  </div>
                ) : null}
              </div>

              <div className="shrink-0 flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full px-3 py-1 text-[12px] font-semibold ${
                    product?.active ? "bg-[#9CE2BB] text-[#11500F]" : "bg-black/5 text-black/55"
                  }`}
                >
                  {product?.active ? "Active" : "Inactive"}
                </span>

                <span className="inline-flex items-center rounded-full bg-black/5 px-3 py-1 text-[12px] font-semibold text-black/70">
                  {counts.pub} public{isInternalUser ? ` • ${counts.internal} internal` : ""}
                </span>

                <span className="inline-flex items-center rounded-full bg-black/5 px-3 py-1 text-[12px] font-semibold text-black/70">
                  Showing: Public{isInternalUser ? " + Internal" : ""}
                </span>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {TAB_DEFS.map((t) => {
              const on = t.key === activeTab;
              return (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`shrink-0 rounded-full border px-4 py-2 text-[12px] font-semibold transition ${
                    on ? "border-[#047835] bg-[#047835] text-white" : "border-black/10 bg-white text-black hover:bg-black/[0.03]"
                  }`}
                  type="button"
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          <div className="mt-4 rounded-3xl border border-black/10 bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-black">{TAB_DEFS.find((t) => t.key === activeTab)?.label}</div>
                <div className="mt-1 text-sm text-[#76777B]">Click an item to open/download via signed URL.</div>
              </div>

              <div className="text-[12px] text-black/50 shrink-0">
                {filtered.length} item{filtered.length === 1 ? "" : "s"}
              </div>
            </div>

            <div className="mt-4 grid gap-3">
              {filtered.length === 0 ? (
                <div className="rounded-2xl border border-black/10 bg-[#F6F7F8] p-4 text-sm text-black/60">
                  Nothing in this tab yet.
                  {storagePrefix ? (
                    <div className="mt-2 text-[12px] text-black/40">
                      Picked prefix: <span className="font-mono">{storagePrefix}/</span>
                    </div>
                  ) : null}
                </div>
              ) : (
                filtered.map((a) => {
                  const badge = groupBadgeFromPath(a.path);
                  return (
                    <a
                      key={a.id}
                      href={docOpenHref(a.path, true)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full overflow-hidden tfext-left rounded-2xl border border-black/10 bg-white p-4 hover:bg-black/[0.03] transition"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="text-sm font-semibold text-black truncate">{a.title || "Untitled"}</div>
                            {badge ? (
                              <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-semibold text-black/70">
                                {badge}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 text-[12px] text-[#76777B] truncate">
                            {typeFromPath(a.path)} • {a.visibility} • {a.path}
                          </div>
                        </div>

                        <div className="w-full sm:w-auto sm:shrink-0">
                          <div className="inline-flex w-full items-center justify-center rounded-xl bg-[#047835] px-3 py-2 text-[12px] font-semibold text-white whitespace-nowrap sm:w-auto">
                            Download →
                          </div>
                        </div>
                      </div>
                    </a>
                  );
                })
              )}
            </div>
          </div>

          {/* Admin-only Add Asset */}
          {isAdmin && (
            <div className="mt-4 rounded-3xl border border-black/10 bg-white p-5">
              <div className="text-sm font-semibold text-black">Add asset</div>
              <div className="mt-1 text-sm text-[#76777B]">
                Admin-only. Path is the object name inside the <span className="font-semibold">knowledge</span> bucket.
              </div>

              <form onSubmit={submitAddAsset} className="mt-4 grid gap-3 sm:grid-cols-4">
                <input
                  value={form.title}
                  onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))}
                  placeholder="Title"
                  className="h-10 rounded-2xl border border-black/10 bg-[#F6F7F8] px-4 text-sm outline-none focus:border-[#047835]"
                />

                <select
                  value={form.category_key}
                  onChange={(e) => setForm((s) => ({ ...s, category_key: e.target.value }))}
                  className="h-10 rounded-2xl border border-black/10 bg-[#F6F7F8] px-4 text-sm outline-none focus:border-[#047835]"
                >
                  <option value="spec_document">spec_document</option>
                  <option value="data_sheet">data_sheet</option>
                  <option value="install_sheet">install_sheet</option>
                  <option value="sales_sheet">sales_sheet</option>
                  <option value="other">other</option>
                </select>

                <select
                  value={form.type}
                  onChange={(e) => setForm((s) => ({ ...s, type: e.target.value }))}
                  className="h-10 rounded-2xl border border-black/10 bg-[#F6F7F8] px-4 text-sm outline-none focus:border-[#047835]"
                >
                  <option value="document">document</option>
                  <option value="image">image</option>
                  <option value="video">video</option>
                  <option value="link">link</option>
                </select>

                <select
                  value={form.visibility}
                  onChange={(e) => setForm((s) => ({ ...s, visibility: e.target.value as any }))}
                  className="h-10 rounded-2xl border border-black/10 bg-[#F6F7F8] px-4 text-sm outline-none focus:border-[#047835]"
                >
                  <option value="public">public</option>
                  <option value="internal">internal</option>
                </select>

                <input
                  value={form.path}
                  onChange={(e) => setForm((s) => ({ ...s, path: e.target.value }))}
                  placeholder="knowledge path (e.g. tpo/u-anchors/u2000/tpo/data-sheet.pdf)"
                  className="h-10 sm:col-span-4 rounded-2xl border border-black/10 bg-[#F6F7F8] px-4 text-sm outline-none focus:border-[#047835]"
                />

                <div className="sm:col-span-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    type="submit"
                    disabled={adding}
                    className="inline-flex h-10 items-center justify-center rounded-2xl bg-[#047835] px-4 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {adding ? "Adding…" : "Add asset"}
                  </button>

                  {formMsg ? (
                    <div className="text-sm text-black/70">{formMsg}</div>
                  ) : (
                    <div className="text-[12px] text-black/50">Tip: Storage listing works without this.</div>
                  )}
                </div>
              </form>
            </div>
          )}
        </>
      )}
    </section>
  );
}
