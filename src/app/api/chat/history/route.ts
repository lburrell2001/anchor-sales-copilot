import { NextResponse } from "next/server";
import { supabaseRoute } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const res = NextResponse.next();
  const supabase = supabaseRoute(req, res);

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = auth.user.id;

  // 1) get active session or create
  let { data: session } = await supabase
    .from("chat_sessions")
    .select("id,title")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .maybeSingle();

  if (!session) {
    const { data: created, error } = await supabase
      .from("chat_sessions")
      .insert({ user_id: userId, title: "Sales Co-Pilot" })
      .select("id,title")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    session = created;
  }

  // 2) get summary (optional)
  const { data: summaryRow } = await supabase
    .from("chat_summaries")
    .select("summary")
    .eq("session_id", session.id)
    .maybeSingle();

  // 3) last 30 messages
  const { data: messages, error: msgErr } = await supabase
    .from("chat_messages")
    .select("id,role,content,created_at")
    .eq("session_id", session.id)
    .order("created_at", { ascending: true })
    .limit(30);

  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 });

  return NextResponse.json(
    {
      sessionId: session.id,
      title: session.title,
      summary: summaryRow?.summary || "",
      messages: messages || [],
    },
    { headers: res.headers }
  );
}
