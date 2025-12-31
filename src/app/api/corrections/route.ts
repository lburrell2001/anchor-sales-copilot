import { NextResponse } from "next/server";
import { supabaseRoute } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: Request) {
  const supabase = supabaseRoute();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return jsonError("Unauthorized", 401);

  const user = auth.user;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  const conversation_id = body.conversationId ?? body.conversation_id ?? null;
  const session_id = body.sessionId ?? body.session_id ?? null;

  const chunk_id = body.chunkId ?? body.chunk_id ?? null;
  const document_id = body.documentId ?? body.document_id ?? null;

  const correction = typeof body.correction === "string" ? body.correction.trim() : "";
  const note = typeof body.note === "string" ? body.note.trim() : null;

  if (!conversation_id) return jsonError("conversationId is required");
  if (!session_id) return jsonError("sessionId is required");
  if (!correction) return jsonError("correction is required");

  const insertRow: any = {
    user_id: user.id,
    conversation_id,
    session_id,
    document_id,
    chunk_id,
    note,
    correction,
    status: body.status ?? "pending",
  };

  if (body.assistantMessageId || body.assistant_message_id) {
    insertRow.assistant_message_id = body.assistantMessageId ?? body.assistant_message_id;
  }

  const { data: inserted, error } = await supabase
    .from("knowledge_corrections")
    .insert(insertRow)
    .select("id")
    .maybeSingle();

  if (error) return jsonError(error.message, 500);

  return NextResponse.json({ ok: true, id: inserted?.id ?? null });
}
