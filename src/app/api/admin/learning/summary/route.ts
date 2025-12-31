export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseRoute } from "@/lib/supabase/server";

async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (data?.role !== "admin") throw new Error("Forbidden");
}

export async function GET(req: Request) {
  const res = NextResponse.next();
  const supabase = supabaseRoute(req, res);

  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await assertAdmin(supabase, user.id);

    // docs with most downvotes
    const { data: docs } = await supabase.rpc("admin_docs_most_downvoted", { limit_count: 25 });

    // open correction tickets
    const { data: corrections } = await supabase
      .from("knowledge_corrections")
      .select("id,created_at,created_by,correction_text,proposed_doc_id,status")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(50);

    return NextResponse.json({ ok: true, docs: docs || [], corrections: corrections || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Forbidden" }, { status: 403 });
  }
}
