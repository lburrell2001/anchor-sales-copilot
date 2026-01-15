// src/app/api/doc-open/route.ts
import { NextResponse } from "next/server";
import { supabaseRoute } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function filenameFromPath(path: string) {
  const clean = path.split("?")[0];
  return clean.split("/").pop() || "document";
}

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || null;
}

export async function GET(req: Request) {
  try {
    // 1) cookie session (if available)
    const supabase = await supabaseRoute();
    const { data: auth1, error: authErr } = await supabase.auth.getUser();
    let user = auth1?.user ?? null;

    // 2) bearer fallback (doesn't affect existing <a> usage; helps fetch-based callers)
    if (!user) {
      const token = getBearerToken(req);
      if (token) {
        const { data: auth2, error: auth2Err } = await supabaseAdmin.auth.getUser(token);
        if (!auth2Err) user = auth2?.user ?? null;
      }
    }

    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const path = (url.searchParams.get("path") || "").trim();
    const download = url.searchParams.get("download") === "1";
    if (!path) return NextResponse.json({ error: "Missing path" }, { status: 400 });

    const BUCKET = "knowledge";

    const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, 60 * 10);

    const signed = data?.signedUrl;
    if (error || !signed) {
      return NextResponse.json({ error: error?.message || "Sign failed" }, { status: 500 });
    }

    // ✅ ADDITION: best-effort logging (do not block serving the file)
    try {
      await supabaseAdmin.from("doc_events").insert({
        user_id: user.id,
        doc_path: path,
        doc_title: filenameFromPath(path),
        doc_type: path.split(".").pop()?.toLowerCase() || "doc",
        doc_url: null,
      });
    } catch {
      // ignore logging failures
    }

    if (!download) return NextResponse.redirect(signed, { status: 302 });

    const upstream = await fetch(signed);
    if (!upstream.ok) {
      return NextResponse.json({ error: `Fetch failed: ${upstream.status}` }, { status: 502 });
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const filename = filenameFromPath(path);

    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
