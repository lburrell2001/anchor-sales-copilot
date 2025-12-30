import { NextResponse } from "next/server";
import { supabaseRoute } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: { id: string } }) {
  try {
    const res = NextResponse.next();
    const supabase = supabaseRoute(req as any, res as any);

    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const conversationId = ctx.params.id;

    // ensure convo belongs to user
    const { data: convo } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!convo?.id) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data, error } = await supabase
      .from("messages")
      .select("role,content,created_at")
      .eq("user_id", user.id)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) throw error;

    return NextResponse.json({ messages: data || [] }, { headers: res.headers });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
