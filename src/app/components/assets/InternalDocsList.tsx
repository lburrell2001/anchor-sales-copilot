"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

type ProductRow = { id: string; name: string | null };

type AssetRow = {
  id: string;
  title: string | null;
  category_key: string | null;
  type: string | null;
  path: string;
  visibility: "public" | "internal";
  created_at: string;
};

type ProfileRow = { id: string; role: string };

function isInternalRole(role: string) {
  return role === "admin" || role === "anchor_rep";
}

function docOpenHref(path: string, download = true) {
  const p = String(path || "").trim();
  return `/api/doc-open?path=${encodeURIComponent(p)}${download ? "&download=1" : ""}`;
}
function isDocxPath(path: string) {
  const p = String(path || "").toLowerCase().split("?")[0];
  return p.endsWith(".docx");
}

function shouldDownload(asset: AssetRow) {
  // Word should download, PDF should open
  // Use either category_key OR extension as fallback
  if (asset.category_key === "rep_agreement_docx") return true;
  if (asset.category_key === "rep_agreement_pdf") return false;
  return isDocxPath(asset.path);
}

function extOf(name: string) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function isPdf(file: File) {
  return file.type === "application/pdf" || extOf(file.name) === "pdf";
}

function isDocx(file: File) {
  return (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    extOf(file.name) === "docx"
  );
}

export default function InternalDocsList({ productId }: { productId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const UPLOAD_ENDPOINT = "/api/internal-assets/rep-agreements/upload";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [product, setProduct] = useState<ProductRow | null>(null);
  const [assets, setAssets] = useState<AssetRow[]>([]);

  const [isInternalUser, setIsInternalUser] = useState(false);

  // Upload form
  const [uploading, setUploading] = useState(false);
  const [formMsg, setFormMsg] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [docxFile, setDocxFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      if (!productId) {
        setError("Missing product id.");
        setLoading(false);
        return;
      }

      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;
      if (!user) {
        setError("Not signed in.");
        setLoading(false);
        return;
      }

      // role
      try {
        const { data: prof } = await supabase
          .from("profiles")
          .select("id,role")
          .eq("id", user.id)
          .maybeSingle();

        const role = (prof as ProfileRow | null)?.role || "";
        setIsInternalUser(isInternalRole(role));
      } catch {
        setIsInternalUser(false);
      }

      // product title
      const { data: p, error: pErr } = await supabase
        .from("products")
        .select("id,name")
        .eq("id", productId)
        .maybeSingle();

      if (pErr || !p) {
        setError(pErr?.message || "Internal list not found.");
        setLoading(false);
        return;
      }

      // docs for this internal list
      const { data: a, error: aErr } = await supabase
        .from("assets")
        .select("id,title,category_key,type,path,visibility,created_at")
        .eq("product_id", productId)
        .eq("visibility", "internal")
        .order("created_at", { ascending: false });

      if (aErr) {
        setError(aErr.message);
        setLoading(false);
        return;
      }

      setProduct(p as ProductRow);
      setAssets(((a as AssetRow[]) ?? []) as AssetRow[]);
      setLoading(false);
    } catch (e: any) {
      setError(e?.message || "Failed to load internal documents.");
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  async function uploadPair(e: React.FormEvent) {
    e.preventDefault();
    setFormMsg(null);

    if (!isInternalUser) return setFormMsg("You don’t have permission to upload internal documents.");

    const t = title.trim();
    if (!t) return setFormMsg("Title is required.");
    if (!pdfFile || !docxFile) return setFormMsg("Please select BOTH a PDF and a Word (.docx) file.");
    if (!isPdf(pdfFile)) return setFormMsg("PDF file must be a .pdf.");
    if (!isDocx(docxFile)) return setFormMsg("Word file must be a .docx.");

    setUploading(true);

    try {
      const fd = new FormData();
      fd.append("productId", productId);
      fd.append("title", t);
      fd.append("pdf", pdfFile);
      fd.append("docx", docxFile);

      const res = await fetch(UPLOAD_ENDPOINT, { method: "POST", body: fd, cache: "no-store" });

      if (res.status === 404) {
        setFormMsg(
          "Upload API not found (404). Confirm you created: src/app/api/internal-assets/rep-agreements/upload/route.ts and restart the dev server."
        );
        setUploading(false);
        return;
      }

      const contentType = res.headers.get("content-type") || "";
      const raw = await res.text();

      if (!contentType.includes("application/json")) {
        setFormMsg(`Upload failed (HTTP ${res.status}). ${raw.replace(/\s+/g, " ").slice(0, 220)}`);
        setUploading(false);
        return;
      }

      const json = JSON.parse(raw);

      if (!res.ok) {
        setFormMsg(json?.error || `Upload failed (HTTP ${res.status}).`);
        setUploading(false);
        return;
      }

      setTitle("");
      setPdfFile(null);
      setDocxFile(null);
      setFileInputKey((k) => k + 1);
      setFormMsg("Uploaded!");
      setUploading(false);
      await load();
    } catch (err: any) {
      setFormMsg(err?.message || "Upload failed.");
      setUploading(false);
    }
  }

  return (
    <main className="min-h-dvh bg-[#F6F7F8] text-black">
      <header className="sticky top-0 z-30 bg-[#047835] pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/assets"
              className="h-9 w-9 rounded-md bg-white/10 border border-white/20 flex items-center justify-center shrink-0"
              title="Back to Asset Library"
            >
              <img src="/anchorp.svg" alt="Anchor Products" className="h-10 w-auto" />
            </Link>

            <div className="leading-tight min-w-0">
              <div className="text-sm font-semibold tracking-wide truncate text-white">Internal documents</div>
              <div className="text-[12px] text-white/75 truncate">{product?.name || "Internal list"}</div>
            </div>
          </div>

          <Link
            href="/assets"
            className="shrink-0 inline-flex items-center rounded-xl bg-white/10 px-3 py-2 text-[12px] font-semibold text-white border border-white/15 hover:bg-white/15 transition"
          >
            Asset Library
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-5 py-6 space-y-4">
        <section className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-black">Documents</div>
              <div className="mt-1 text-sm text-[#76777B]">Internal-only list. Click to download.</div>
            </div>
            <div className="text-[12px] text-black/50 shrink-0">
              {!loading && !error ? `${assets.length} item${assets.length === 1 ? "" : "s"}` : ""}
            </div>
          </div>

          <div className="mt-4">
            {error ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
            ) : loading ? (
              <div className="rounded-2xl border border-black/10 bg-[#F6F7F8] p-4 text-sm text-black/60">Loading…</div>
            ) : assets.length === 0 ? (
              <div className="rounded-2xl border border-black/10 bg-[#F6F7F8] p-4 text-sm text-black/60">
                No documents yet.
              </div>
            ) : (
              <div className="grid gap-3">
                {assets.map((a) => {
  const download = shouldDownload(a);
  const href = docOpenHref(a.path, download);
  const isPdf = (p: string) => p.toLowerCase().endsWith(".pdf");

  return (
    <a
  key={a.id}
  href={docOpenHref(a.path, !isPdf(a.path))} // ✅ pdf => download=false (inline), doc/docx => download=true
  target="_blank"
  rel="noopener noreferrer"
  className="block w-full overflow-hidden rounded-2xl border border-black/10 bg-white p-4 text-left transition hover:bg-black/[0.03]"
>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-black truncate">{a.title || "Untitled"}</div>
          <div className="mt-1 text-[12px] text-[#76777B] truncate">
            {a.category_key || a.type} • {a.visibility}
          </div>
        </div>

        <div className="w-full sm:w-auto sm:shrink-0">
          <div className="inline-flex w-full items-center justify-center rounded-xl bg-[#047835] px-3 py-2 text-[12px] font-semibold text-white whitespace-nowrap sm:w-auto">
            {download ? "Download →" : "Open →"}
          </div>
        </div>
      </div>
    </a>
  );
})}

              </div>
            )}
          </div>
        </section>

        {isInternalUser && (
          <section className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm">
            <div className="text-sm font-semibold text-black">Add rep agreement</div>
            <div className="mt-1 text-sm text-[#76777B]">
              Upload both a <span className="font-semibold">PDF</span> and{" "}
              <span className="font-semibold">Word (.docx)</span> version. They will appear above automatically.
            </div>

            <form onSubmit={uploadPair} className="mt-4 grid gap-3">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Agreement title (ex: Independent Rep Agreement v1)"
                className="h-10 rounded-2xl border border-black/10 bg-[#F6F7F8] px-4 text-sm outline-none focus:border-[#047835]"
              />

              <div className="grid gap-3 sm:grid-cols-2" key={fileInputKey}>
                <label className="rounded-2xl border border-black/10 bg-[#F6F7F8] p-4">
                  <div className="text-[12px] font-semibold text-black">PDF file (required)</div>
                  <div className="mt-1 text-[12px] text-black/50 truncate">{pdfFile ? pdfFile.name : "Choose a .pdf"}</div>
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    className="mt-3 block w-full text-sm"
                    onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
                  />
                </label>

                <label className="rounded-2xl border border-black/10 bg-[#F6F7F8] p-4">
                  <div className="text-[12px] font-semibold text-black">Word file (required)</div>
                  <div className="mt-1 text-[12px] text-black/50 truncate">{docxFile ? docxFile.name : "Choose a .docx"}</div>
                  <input
                    type="file"
                    accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    className="mt-3 block w-full text-sm"
                    onChange={(e) => setDocxFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="submit"
                  disabled={uploading}
                  className="inline-flex h-10 items-center justify-center rounded-2xl bg-[#047835] px-4 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {uploading ? "Uploading…" : "Upload agreement"}
                </button>

                {formMsg ? (
                  <div className="text-sm text-black/70">{formMsg}</div>
                ) : (
                  <div className="text-[12px] text-black/50">
                    Upload endpoint: <span className="font-semibold">{UPLOAD_ENDPOINT}</span>
                  </div>
                )}
              </div>
            </form>
          </section>
        )}
      </div>
    </main>
  );
}
