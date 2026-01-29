// src/app/api/doc-open/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseRoute } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizePathInput(s: string) {
  return decodeURIComponent((s || "").trim()).replace(/^\/+/, "").replace(/\/+$/, "");
}

function filenameFromPath(path: string) {
  const clean = String(path || "").split("?")[0];
  return clean.split("/").pop() || "download";
}

function extOf(path: string) {
  const m = filenameFromPath(path).toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

function contentTypeFor(path: string) {
  const ext = extOf(path);
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "mp4") return "video/mp4";
  if (ext === "docx")
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === "pptx")
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  return "application/octet-stream";
}

function isInternalPath(path: string) {
  const p = String(path || "").toLowerCase();
  return (
    p.includes("/internal/") ||
    p.startsWith("internal/") ||
    p.includes("/pricebook/") ||
    p.includes("/test/") ||
    p.includes("/test-reports/")
  );
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const path = normalizePathInput(searchParams.get("path") || "");
  const download = searchParams.get("download") === "1";

  // ✅ NEW: allow token via query param for mobile (because window.location can't send headers)
  const tokenFromQuery = (searchParams.get("token") || "").trim();

  if (!path) return NextResponse.json({ error: "Missing path" }, { status: 400 });

  /* ------------------------------------------------
     ✅ Auth (cookie OR bearer OR token query)
     - If no auth, we still allow PUBLIC docs
     - Internal docs still require auth
  ------------------------------------------------- */

  let user: any = null;

  // 1) Cookie-based auth (desktop)
  try {
    const supabase = await supabaseRoute();
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (!authErr && auth?.user) user = auth.user;
  } catch {
    // ignore
  }

  // 2) Bearer token auth (if you ever fetch doc-open with headers)
  if (!user) {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";

    if (token) {
      const { data, error } = await supabaseAdmin.auth.getUser(token);
      if (!error && data?.user) user = data.user;
    }
  }

  // 3) Token from query string (mobile-safe)
  if (!user && tokenFromQuery) {
    const { data, error } = await supabaseAdmin.auth.getUser(tokenFromQuery);
    if (!error && data?.user) user = data.user;
  }

  // 4) If still not authed, only allow PUBLIC paths
  if (!user && isInternalPath(path)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  /* ------------------------------------------------
     ✅ INLINE VIEW: redirect to signed URL
  ------------------------------------------------- */

  if (!download) {
    const { data, error } = await supabaseAdmin.storage.from("knowledge").createSignedUrl(path, 60 * 30);

    if (error || !data?.signedUrl) {
      return NextResponse.json({ error: "Could not create signed url" }, { status: 500 });
    }

    return NextResponse.redirect(data.signedUrl, 302);
  }

  /* ------------------------------------------------
     ✅ DOWNLOAD: proxy so attachment is forced
  ------------------------------------------------- */

  const { data: file, error: dlErr } = await supabaseAdmin.storage.from("knowledge").download(path);

  if (dlErr || !file) {
    return NextResponse.json({ error: "Could not download file" }, { status: 500 });
  }

  const arrayBuf = await file.arrayBuffer();
  const filename = filenameFromPath(path);
  const contentType = contentTypeFor(path);

  return new NextResponse(arrayBuf, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}

export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}
