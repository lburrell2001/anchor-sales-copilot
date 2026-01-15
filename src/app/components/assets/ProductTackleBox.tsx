// src/components/assets/ProductTackleBox.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useRouter } from "next/navigation";

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
  type: string | null; // document | image | video (generic)
  category_key: string | null; // data_sheet, spec_document, etc.
  path: string;
  visibility: "public" | "internal";
  created_at: string;
};

type ProfileRow = {
  id: string;
  role: string;
};

// ✅ Tabs filter by category_key (NOT assets.type)
const TAB_DEFS: {
  key: string;
  label: string;
  categoryKeys: string[];
  visibility?: "public" | "internal";
}[] = [
  // ✅ include legacy spec keys for back-compat
  {
    key: "spec",
    label: "Spec Document",
    categoryKeys: ["spec_document", "spec", "specs", "spec_sheet"],
    visibility: "public",
  },
  { key: "data", label: "Data Sheet", categoryKeys: ["data_sheet", "product_data_sheet"], visibility: "public" },
  { key: "install", label: "Install Guide", categoryKeys: ["install_manual", "install_sheet"], visibility: "public" },
  { key: "sales", label: "Sales Sheet", categoryKeys: ["sales_sheet"], visibility: "public" },
  { key: "intake", label: "Intake Form", categoryKeys: ["solution_intake_form", "intake_form"], visibility: "public" },
  { key: "pics", label: "Pictures", categoryKeys: ["product_image", "image", "pictures"], visibility: "public" },
  { key: "case", label: "Case Studies", categoryKeys: ["case_study"], visibility: "public" },
  { key: "pres", label: "Presentations", categoryKeys: ["presentation"], visibility: "public" },
  { key: "letters", label: "Approval Letters", categoryKeys: ["manufacturer_approval_letter"], visibility: "public" },

  // Internal-only tabs
  { key: "tests", label: "Test Reports", categoryKeys: ["test_report"], visibility: "internal" },
  { key: "price", label: "Pricebook", categoryKeys: ["pricebook"], visibility: "internal" },

  { key: "other", label: "Other", categoryKeys: ["asset", "other", "unknown", ""], visibility: "public" },
];

function docOpenHref(path: string, download = true) {
  const p = String(path || "").trim();
  return `/api/doc-open?path=${encodeURIComponent(p)}${download ? "&download=1" : ""}`;
}

// legacy/back-compat category normalization:
// - prefer category_key, but fall back to type
// - map common older spec variants to spec_document
function canonicalCategory(a: AssetRow) {
  const raw = String(a.category_key || a.type || "").toLowerCase().trim();
  if (raw === "spec" || raw === "specs" || raw === "spec_sheet") return "spec_document";
  return raw;
}

export default function ProductTackleBox({ productId }: { productId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [loading, setLoading] = useState(true);
  const [product, setProduct] = useState<ProductRow | null>(null);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [activeTab, setActiveTab] = useState(TAB_DEFS[0].key);
  const [error, setError] = useState<string | null>(null);

  const [isInternalUser, setIsInternalUser] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const router = useRouter();

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

    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;

      // determine internal/admin from profiles.role
      if (user) {
        try {
          const { data: prof } = await supabase
            .from("profiles")
            .select("id,role")
            .eq("id", user.id)
            .maybeSingle();

          const role = (prof as ProfileRow | null)?.role || "";
          const internal = role === "admin" || role === "anchor_rep";
          setIsInternalUser(internal);
          setIsAdmin(role === "admin");
        } catch {
          setIsInternalUser(false);
          setIsAdmin(false);
        }
      } else {
        setIsInternalUser(false);
        setIsAdmin(false);
      }

      // product
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
      if (p.section === "internal_assets") {
  const kind = (p as ProductRow).internal_kind;

  if (kind === "contacts_list") {
    router.replace(`/internal-assets/contacts/${encodeURIComponent(p.id)}`);
  } else {
    router.replace(`/internal-assets/docs/${encodeURIComponent(p.id)}`);
  }

  setLoading(false);
  return;
}

      console.log("ProductTackleBox loaded product:", {
  id: p.id,
  name: p.name,
  section: p.section,
  internal_kind: (p as any).internal_kind,
});


      // product assets (no global spec injection)
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
      setAssets((a as AssetRow[]) ?? []);
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

  const tab = TAB_DEFS.find((t) => t.key === activeTab) ?? TAB_DEFS[0];

  const visibleTabs = useMemo(() => {
    return TAB_DEFS.filter((t) => {
      if (t.visibility === "internal") return isInternalUser;
      return true;
    });
  }, [isInternalUser]);

  useEffect(() => {
    if (!visibleTabs.some((t) => t.key === activeTab)) {
      setActiveTab(visibleTabs[0]?.key || TAB_DEFS[0].key);
    }
  }, [visibleTabs, activeTab]);

  const filtered = useMemo(() => {
    const allowed = new Set(tab.categoryKeys.map((k) => String(k || "").toLowerCase().trim()));
    return assets.filter((x) => allowed.has(canonicalCategory(x)));
  }, [assets, tab.categoryKeys]);

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
        <div className="rounded-2xl border border-black/10 bg-[#F6F7F8] p-4 text-sm text-black/60">
          Loading tackle box…
        </div>
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
              </div>

              <div className="shrink-0 flex items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full px-3 py-1 text-[12px] font-semibold ${
                    product?.active ? "bg-[#9CE2BB] text-[#11500F]" : "bg-black/5 text-black/55"
                  }`}
                >
                  {product?.active ? "Active" : "Inactive"}
                </span>

                <span className="inline-flex items-center rounded-full bg-black/5 px-3 py-1 text-[12px] font-semibold text-black/70">
                  Showing: Public{isInternalUser ? " + Internal" : ""}
                </span>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {visibleTabs.map((t) => {
              const on = t.key === activeTab;
              return (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`shrink-0 rounded-full border px-4 py-2 text-[12px] font-semibold transition ${
                    on
                      ? "border-[#047835] bg-[#047835] text-white"
                      : "border-black/10 bg-white text-black hover:bg-black/[0.03]"
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
                <div className="text-sm font-semibold text-black">{tab.label}</div>
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
                </div>
              ) : (
                filtered.map((a) => (
                  <a
                    key={a.id}
                    href={docOpenHref(a.path, true)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full overflow-hidden text-left rounded-2xl border border-black/10 bg-white p-4 hover:bg-black/[0.03] transition"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-black truncate">{a.title || "Untitled"}</div>
                        <div className="mt-1 text-[12px] text-[#76777B] truncate">
                          {(a.category_key || a.type) ?? ""} • {a.visibility} • {a.path}
                        </div>
                      </div>

                      <div className="w-full sm:w-auto sm:shrink-0">
                        <div className="inline-flex w-full items-center justify-center rounded-xl bg-[#047835] px-3 py-2 text-[12px] font-semibold text-white whitespace-nowrap sm:w-auto">
                          Download →
                        </div>
                      </div>
                    </div>
                  </a>
                ))
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
                  <option value="product_data_sheet">product_data_sheet</option>
                  <option value="install_manual">install_manual</option>
                  <option value="install_sheet">install_sheet</option>
                  <option value="sales_sheet">sales_sheet</option>
                  <option value="solution_intake_form">solution_intake_form</option>
                  <option value="product_image">product_image</option>
                  <option value="case_study">case_study</option>
                  <option value="presentation">presentation</option>
                  <option value="manufacturer_approval_letter">manufacturer_approval_letter</option>
                  <option value="test_report">test_report</option>
                  <option value="pricebook">pricebook</option>
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
                  placeholder="knowledge path (e.g. spec/anchor-products-spec-v1.docx)"
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
                    <div className="text-[12px] text-black/50">
                      Tip: Spec docs should use <span className="font-semibold">category_key = spec_document</span>
                    </div>
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
