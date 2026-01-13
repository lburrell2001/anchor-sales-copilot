// src/app/api/doc-event/route.ts
import { NextResponse } from "next/server";
import { supabaseRoute } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeJsonParse(input: string) {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  // ✅ Create a real response object for Supabase cookie refresh handling
  const res = NextResponse.json({ ok: true });

  try {
    // 1) Read user session (cookies come from the browser)
    const supabase = supabaseRoute(req, res);

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    const user = auth?.user;

    if (authErr) {
      return NextResponse.json(
        { error: authErr.message || "Auth error" },
        { status: 401 }
      );
    }

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2) Parse payload (sendBeacon may come as text/plain)
    const raw = await req.text().catch(() => "");
    const body = safeJsonParse(raw) ?? {};

    const conversationId = String(body?.conversationId || "").trim() || null;
    const doc = body?.doc || {};

    const doc_path = String(doc?.path || "").trim();
    if (!doc_path) {
      return NextResponse.json({ error: "Missing doc.path" }, { status: 400 });
    }

    const payload = {
      user_id: user.id,
      conversation_id: conversationId,
      doc_path,
      doc_title: String(doc?.title || "").trim() || null,
      doc_type: String(doc?.doc_type || "").trim() || null,
      doc_url: String(doc?.url || "").trim() || null,
      // If your DB already defaults created_at, you can remove this:
      created_at: new Date().toISOString(),
    };

    // 3) Insert with service role (bypasses RLS)
    const { error: insertErr } = await supabaseAdmin.from("doc_events").insert(payload);

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    // ✅ Return the response object we created (so any auth cookie refresh can be applied)
    return res;
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
