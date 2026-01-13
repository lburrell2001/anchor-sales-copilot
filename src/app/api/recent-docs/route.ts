import { NextResponse } from "next/server";
import { supabaseRoute } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const res = NextResponse.json({ ok: true });

  try {
    // ✅ session-aware client (reads cookies)
    const supabase = supabaseRoute(req, res);
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    const user = auth?.user;

    if (authErr || !user) {
      return NextResponse.json({ docs: [] }, { status: 200 });
    }

    // ✅ pull last 5 doc opens for this user
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
