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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const path = normalizePathInput(searchParams.get("path") || "");
  const download = searchParams.get("download") === "1";

  if (!path) return NextResponse.json({ error: "Missing path" }, { status: 400 });

  // Keep if docs should require login
  const supabase = await supabaseRoute();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ✅ Inline view: redirect to signed URL (fast + mobile-friendly)
  if (!download) {
    const { data, error } = await supabaseAdmin
      .storage
      .from("knowledge")
      .createSignedUrl(path, 60 * 30);

    if (error || !data?.signedUrl) {
      return NextResponse.json({ error: "Could not create signed url" }, { status: 500 });
    }

    return NextResponse.redirect(data.signedUrl, 302);
  }

  // ✅ Download: PROXY the file so we can force attachment reliably
  const { data: file, error: dlErr } = await supabaseAdmin.storage
    .from("knowledge")
    .download(path);

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
      // helps some browsers not sniff
      "X-Content-Type-Options": "nosniff",
      // optional: reduce caching issues for signed content
      "Cache-Control": "no-store",
    },
  });
}

export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}
