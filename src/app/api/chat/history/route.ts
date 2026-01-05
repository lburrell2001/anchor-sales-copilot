// src/app/api/chat/history/route.ts
import { NextResponse } from "next/server";
import { supabaseRoute } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function withForwardedHeaders(base: NextResponse, out: NextResponse) {
  base.headers.forEach((value, key) => out.headers.set(key, value));
  return out;
}

/**
 * Back-compat:
 * Some older assistant rows may have stored docs payload as JSON in `content`
 * (ex: { type: "docs_only", recommendedDocs, foldersUsed, answer }).
 * This route normalizes that into `meta` so the UI can rehydrate the "See docs" button.
 */
function normalizeRow(row: any) {
  const role = row?.role;
  const content = (row?.content ?? "").toString();
  const meta = row?.meta && typeof row.meta === "object" ? row.meta : null;

  // If meta already present, return as-is (but ensure object)
  if (meta && Object.keys(meta).length) {
    return { ...row, meta };
  }

  // Try to parse JSON stored in content (legacy)
  if (role === "assistant") {
    try {
      const parsed = JSON.parse(content);

      // Only accept the shapes we expect
      const hasDocs =
        parsed &&
        typeof parsed === "object" &&
        (parsed.type === "docs_only" || parsed.type === "assistant_with_docs") &&
        Array.isArray(parsed.recommendedDocs);

      if (hasDocs) {
        const nextMeta = {
          type: parsed.type,
          recommendedDocs: parsed.recommendedDocs,
          foldersUsed: Array.isArray(parsed.foldersUsed) ? parsed.foldersUsed : [],
        };

        // Keep `content` readable for your UI:
        // - docs_only -> ""
        // - assistant_with_docs -> parsed.answer (or "")
        const nextContent =
          parsed.type === "assistant_with_docs"
            ? (parsed.answer ?? "").toString()
            : "";

        return { ...row, content: nextContent, meta: nextMeta };
      }
    } catch {
      // not JSON, ignore
    }
  }

  // Default: ensure meta is at least an object (not null) for easier UI handling
  return { ...row, meta: {} };
}

export async function GET(req: Request) {
  const base = NextResponse.next();

  try {
    const { searchParams } = new URL(req.url);
    const conversationId = (searchParams.get("conversationId") || "").trim();

    if (!conversationId) {
      const out = NextResponse.json({ error: "Missing conversationId" }, { status: 400 });
      return withForwardedHeaders(base, out);
    }

    const supabase = supabaseRoute(req, base);

    const { data: authData, error: authErr } = await supabase.auth.getUser();
    const user = authData?.user;

    if (authErr || !user) {
      const out = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      return withForwardedHeaders(base, out);
    }

    // ✅ include meta so UI can rehydrate docs/buttons
    // ✅ also include id for stable client keys
    const { data: rows, error } = await supabase
      .from("messages")
      .select("id,role,content,meta,created_at")
      .eq("user_id", user.id)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(500);

    if (error) throw error;

    const normalized = (rows || []).map(normalizeRow);

    const out = NextResponse.json(
      {
        conversationId,
        messages: normalized,
      },
      { status: 200 }
    );

    return withForwardedHeaders(base, out);
  } catch (err: any) {
    const out = NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
    return withForwardedHeaders(base, out);
  }
}
