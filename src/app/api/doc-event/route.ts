// src/app/api/doc-event/route.ts
import { NextResponse } from "next/server";
import { supabaseRoute } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    // 1) Read user session (requires cookies from the browser)
    const base = NextResponse.next();
const supabase = supabaseRoute(req, base);

    const { data: auth, error: authErr } = await supabase.auth.getUser();

console.log("doc-event authErr:", authErr);
console.log("doc-event user:", auth?.user?.id);

const user = auth?.user;
if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });


    // 2) Parse payload
    const body = await req.json().catch(() => ({}));
    const conversationId = String(body?.conversationId || "").trim() || null;
    const doc = body?.doc || {};

    const doc_path = String(doc?.path || "").trim();
    if (!doc_path) return NextResponse.json({ error: "Missing doc.path" }, { status: 400 });

    const payload = {
      user_id: user.id,
      conversation_id: conversationId,
      doc_path,
      doc_title: String(doc?.title || "").trim() || null,
      doc_type: String(doc?.doc_type || "").trim() || null,
      doc_url: String(doc?.url || "").trim() || null,
      // let DB default handle created_at if you have it
      created_at: new Date().toISOString(),
    };

    // 3) Insert with service role (bypasses RLS)
    const { error: insertErr } = await supabaseAdmin.from("doc_events").insert(payload);
    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
