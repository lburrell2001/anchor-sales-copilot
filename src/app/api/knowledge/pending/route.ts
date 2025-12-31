import { NextResponse } from "next/server";
import { supabaseRoute } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const base = new Response(null, { status: 200 });
  const supabase = supabaseRoute(req, base as any);

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // simple: only internal users can review (adjust to your role logic if you want)
  const { data: profile } = await supabase
    .from("profiles")
    .select("role,user_type")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (profile?.user_type !== "internal") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("knowledge_documents")
    .select("id,title,category,confidence,raw_text,meta,created_at,status")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data || [] });
}
