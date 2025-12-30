export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseRoute } from "@/lib/supabase/server";
import { chunkText } from "@/lib/knowledge/text";
import { embed } from "@/lib/knowledge/embeddings";

type Body = {
  title: string;
  content: string;
  category?: string;
  product_tags?: string[];
  source_session_id?: string | null;
  source_type?: "chat" | "upload" | "manual_entry";
};

export async function POST(req: Request) {
  const res = NextResponse.next();
  const supabase = supabaseRoute(req, res);

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  const user = auth?.user;
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as Body;
  const title = (body.title || "").trim();
  const content = (body.content || "").trim();

  if (!title || !content) {
    return NextResponse.json({ error: "Missing title/content" }, { status: 400 });
  }

  // 1) create doc (draft)
  const { data: doc, error: docErr } = await supabase
    .from("knowledge_documents")
    .insert({
      title,
      content,
      category: body.category || null,
      product_tags: Array.isArray(body.product_tags) ? body.product_tags : [],
      created_by: user.id,
      source_type: body.source_type || "chat",
      source_session_id: body.source_session_id || null,
      status: "draft",
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (docErr || !doc?.id) {
    return NextResponse.json({ error: docErr?.message || "Doc insert failed" }, { status: 500 });
  }

  // 2) chunk + embed + insert chunks
  const chunks = chunkText(content, 1200);

  const rows = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const embedding = await embed(c);

    rows.push({
      document_id: doc.id,
      chunk_index: i,
      content: c,
      embedding,
      product_tags: Array.isArray(body.product_tags) ? body.product_tags : [],
      token_count: null,
    });
  }

  const { error: chunkErr } = await supabase.from("knowledge_chunks").insert(rows);
  if (chunkErr) {
    return NextResponse.json(
      { error: "Chunks insert failed", details: chunkErr.message, document_id: doc.id },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, document_id: doc.id });
}
