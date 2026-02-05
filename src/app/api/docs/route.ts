// src/app/api/docs/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import mammoth from "mammoth";
import * as pdfParse from "pdf-parse";
import JSZip from "jszip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DocType =
  | "sales_sheet"
  | "data_sheet"
  | "product_data_sheet"
  | "install_manual"
  | "install_sheet"
  | "install_video"
  | "cad_dwg"
  | "cad_step"
  | "product_drawing"
  | "product_image"
  | "render"
  | "asset"
  | "unknown";

type DocOut = {
  title: string;
  doc_type: DocType;
  path: string;
  url: string | null;
  excerpt?: string;
};

/* ---------------------------------------------
   Helpers
--------------------------------------------- */

function normalizePathInput(s: string) {
  return decodeURIComponent((s || "").trim()).replace(/^\/+/, "").replace(/\/+$/, "");
}

function extOf(path: string) {
  const m = path.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

function baseName(path: string) {
  const last = path.split("/").pop() || path;
  return last.replace(/\.[a-z0-9]+$/i, "");
}

function titleCaseWords(s: string) {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function humanizeDocNameFromFile(path: string) {
  const b = baseName(path).toLowerCase();

  if (b.includes("sales-sheet")) return "Sales Sheet";
  if (b.includes("product-data-sheet")) return "Product Data Sheet";
  if (b.includes("data-sheet")) return "Data Sheet";
  if (b.includes("install-manual")) return "Install Manual";
  if (b.includes("install-sheet")) return "Install Sheet";
  if (b.includes("install-video")) return "Install Video";
  if (b.includes("product-drawing")) return "Product Drawing";
  if (b.includes("product-image")) return "Product Image";
  if (b.includes("render")) return "Render";
  if (b === "cad") return "CAD";

  return titleCaseWords(b.replace(/[-_]+/g, " "));
}

function docTypeFromPath(path: string): DocType {
  const p = path.toLowerCase();
  const e = extOf(p);

  if (p.includes("sales-sheet")) return "sales_sheet";
  if (p.includes("product-data-sheet")) return "product_data_sheet";
  if (p.includes("data-sheet")) return "data_sheet";
  if (p.includes("install-manual")) return "install_manual";
  if (p.includes("install-sheet")) return "install_sheet";
  if (p.includes("install-video") || ["mp4", "mov", "webm"].includes(e)) return "install_video";

  if (p.endsWith(".dwg")) return "cad_dwg";
  if (p.endsWith(".step") || p.endsWith(".stp")) return "cad_step";

  if (p.includes("product-drawing")) return "product_drawing";
  if (p.includes("product-image") || ["png", "jpg", "jpeg", "webp"].includes(e)) return "product_image";
  if (p.includes("render")) return "render";

  if (e === "pdf" || e === "docx" || ["odt", "ods", "odp"].includes(e)) return "asset";

  return "unknown";
}

function titleFromPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  const docName = humanizeDocNameFromFile(path);

  const parent = parts.length >= 2 ? parts[parts.length - 2] : "";
  const niceParent = parent ? titleCaseWords(parent.replace(/[-_]+/g, " ")) : "";

  if (niceParent) return `${niceParent} — ${docName}`;
  return docName;
}

function cleanExcerpt(text: string, maxLen: number) {
  const t = (text || "").replace(/\s+/g, " ").replace(/\u0000/g, "").trim();
  if (!t) return "";
  return t.length > maxLen ? t.slice(0, maxLen).trim() : t;
}

function stripXmlToText(xml: string) {
  // Minimal tag stripping + entity decoding. Good enough for snippets.
  let t = (xml || "").toString();

  // Remove script/style blocks if any
  t = t.replace(/<script[\s\S]*?<\/script>/gi, " ");
  t = t.replace(/<style[\s\S]*?<\/style>/gi, " ");

  // Replace common "paragraph-ish" tags with spaces/newlines
  t = t.replace(/<\/(text:p|text:h|p|h[1-6])>/gi, "\n");

  // Remove all tags
  t = t.replace(/<[^>]+>/g, " ");

  // Decode a few common entities
  t = t
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Collapse whitespace
  t = t.replace(/\s+\n/g, "\n").replace(/\n\s+/g, "\n");
  t = t.replace(/[ \t]{2,}/g, " ");
  t = t.replace(/\n{3,}/g, "\n\n").trim();

  return t;
}

async function downloadBufferFromStorage(path: string): Promise<Buffer | null> {
  const { data, error } = await supabaseAdmin.storage.from("knowledge").download(path);
  if (error || !data) return null;

  const arrayBuf = await data.arrayBuffer();
  return Buffer.from(arrayBuf);
}

async function extractTextFromStoragePath(path: string, maxLen: number) {
  const e = extOf(path);

  // Only attempt extract for known text-bearing formats
  const canExtract = ["txt", "md", "pdf", "docx", "odt", "ods", "odp"].includes(e);
  if (!canExtract) return "";

  const buf = await downloadBufferFromStorage(path);
  if (!buf) return "";

  try {
    // Plain text
    if (e === "txt" || e === "md") {
      return cleanExcerpt(buf.toString("utf8"), maxLen);
    }

    // PDF
    if (e === "pdf") {
      const parsed = await (pdfParse as any).default(buf);
      return cleanExcerpt(parsed?.text || "", maxLen);
    }

    // DOCX
    if (e === "docx") {
      const result = await mammoth.extractRawText({ buffer: buf });
      return cleanExcerpt(result?.value || "", maxLen);
    }

    // ODF (ODT/ODS/ODP): ZIP containing content.xml
    if (e === "odt" || e === "ods" || e === "odp") {
      const zip = await JSZip.loadAsync(buf);
      const file = zip.file("content.xml");
      if (!file) return "";

      const xml = await file.async("string");
      const text = stripXmlToText(xml);
      return cleanExcerpt(text, maxLen);
    }

    return "";
  } catch {
    return "";
  }
}

async function signUrlsForPaths(paths: string[], expiresIn: number, withText: boolean, excerptLen: number) {
  const out: DocOut[] = [];

  for (const p of paths) {
    const doc_type = docTypeFromPath(p);
    const title = titleFromPath(p);

    let url: string | null = null;
    const { data, error } = await supabaseAdmin.storage.from("knowledge").createSignedUrl(p, expiresIn);
    if (!error) url = data?.signedUrl ?? null;

    const doc: DocOut = { title, doc_type, path: p, url };

    if (withText) {
      doc.excerpt = await extractTextFromStoragePath(p, excerptLen);
    }

    out.push(doc);
  }

  return out;
}

/**
 * Fast path listing via Postgres: storage.objects
 * Requires service role (supabaseAdmin).
 */
async function listPathsViaDb(opts: { prefix?: string; q?: string; page: number; limit: number }) {
  const { prefix, q, page, limit } = opts;

  const p_prefix = prefix ? normalizePathInput(prefix) : null;
  const p_q = q ? String(q).trim() : null;

  const { data, error } = await supabaseAdmin.rpc("list_knowledge_objects", {
    p_prefix,
    p_q,
    p_page: page,
    p_limit: limit,
  });

  if (error) throw error;

  const rows = (data || []) as any[];
  const names = rows.map((r) => String(r?.name || "")).filter(Boolean);
  const total = rows.length ? Number(rows[0]?.total ?? names.length) : 0;

  return { names, total };
}

/**
 * Filtered listing via knowledge_docs table (visibility-aware).
 * Expects knowledge_docs.path to match storage object path.
 */
async function listPathsViaDocsTable(opts: {
  prefix?: string;
  q?: string;
  page: number;
  limit: number;
  visibility: "public" | "all";
}) {
  const { prefix, q, page, limit, visibility } = opts;

  let query = supabaseAdmin
    .from("knowledge_docs")
    .select("path", { count: "exact" })
    .order("path", { ascending: true });

  if (visibility === "public") {
    query = query.eq("visibility", "public");
  }

  if (prefix) {
    query = query.ilike("path", `${normalizePathInput(prefix)}%`);
  }

  if (q) {
    const qNorm = String(q).trim();
    if (qNorm) query = query.ilike("path", `%${qNorm}%`);
  }

  const from = page * limit;
  const to = from + limit - 1;

  const { data, error, count } = await query.range(from, to);
  if (error) throw error;

  const names = (data || []).map((r: any) => String(r?.path || "")).filter(Boolean);
  return { names, total: count ?? names.length };
}

/**
 * Convenience: build folder from structured params
 * product=u-anchors&model=u3400&membrane=epdm -> anchor/u-anchors/u3400/epdm/
 */
function folderFromStructuredParams(sp: URLSearchParams) {
  // NEW: support solution-style folders
  const solution = (sp.get("solution") || sp.get("securing") || sp.get("s") || "").trim().toLowerCase();

  if (solution) {
    const s = solution.replace(/^\/+/, "").replace(/\/+$/, "");

    // ✅ Default to solutions/ unless already rooted
    if (s.startsWith("solutions/") || s.startsWith("anchor/")) return `${s}/`;
    return `solutions/${s}/`;
  }

  // Existing: u-anchors structured folders
  const product = (sp.get("product") || "").trim().toLowerCase();
  const model = (sp.get("model") || "").trim().toLowerCase();
  const membrane = (sp.get("membrane") || "").trim().toLowerCase();

  if (!product) return "";

  if (product === "u-anchors" || product === "u-anchor" || product === "uanchor" || product === "uanchors") {
    let folder = "anchor/u-anchors/";
    if (model) folder += `${model}/`;
    if (membrane) folder += `${membrane}/`;
    return folder;
  }

  return "";
}

/* ---------------------------------------------
   Handler
--------------------------------------------- */

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const folderRaw = searchParams.get("folder");
    const qRaw = searchParams.get("q");
    const visibilityRaw = (searchParams.get("visibility") || "").toLowerCase();
    const visibility = visibilityRaw === "public" ? "public" : "all";

    const withText = searchParams.get("withText") === "1";
    const excerptLen = Math.min(2000, Math.max(200, Number(searchParams.get("excerptLen") || 700)));

    const page = Math.max(0, Number(searchParams.get("page") || 0));
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") || 20)));

    // Build folder (priority: explicit folder, else structured params)
    const structuredFolder = folderFromStructuredParams(searchParams);
    const folder = folderRaw ? normalizePathInput(folderRaw) : structuredFolder;

    const q = qRaw ? decodeURIComponent(qRaw).trim() : "";

    const { names, total } =
      visibility === "public"
        ? await listPathsViaDocsTable({
            prefix: folder || undefined,
            q: q || undefined,
            page,
            limit,
            visibility,
          })
        : await listPathsViaDb({
            prefix: folder || undefined,
            q: q || undefined,
            page,
            limit,
          });

    const docs = await signUrlsForPaths(names, 60 * 30, withText, excerptLen);

    return NextResponse.json({
      docs,
      page,
      limit: docs.length,
      total,
      hasMore: (page + 1) * limit < total,
      folder: folder || "",
      q: q || "",
    });
  } catch (e: any) {
    return NextResponse.json({ docs: [], error: e?.message || "Unknown error" }, { status: 500 });
  }
}
