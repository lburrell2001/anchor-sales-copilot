import { NextResponse } from "next/server";
import { supabaseRoute } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || null;
}

export async function GET(req: Request) {
  try {
    // 1) cookie session (if available)
    const supabase = await supabaseRoute();
    const { data: auth1 } = await supabase.auth.getUser();
    let user = auth1?.user ?? null;

    // 2) Bearer fallback (works when auth is client-only)
    if (!user) {
      const token = getBearerToken(req);
      if (token) {
        const { data: auth2, error: auth2Err } = await supabaseAdmin.auth.getUser(token);
        if (!auth2Err) user = auth2?.user ?? null;
      }
    }

    // fail-soft for UI
    if (!user) {
      return NextResponse.json({ docs: [] }, { status: 200 });
    }

    const { data, error } = await supabaseAdmin
      .from("doc_events")
      .select("doc_title, doc_type, doc_path, doc_url, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5);

    if (error) {
      return NextResponse.json({ docs: [] }, { status: 200 });
    }

    return NextResponse.json({ docs: data || [] }, { status: 200 });
  } catch {
    return NextResponse.json({ docs: [] }, { status: 200 });
  }
}
