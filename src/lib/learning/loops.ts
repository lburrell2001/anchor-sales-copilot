// src/lib/learning/loops.ts
import OpenAI from "openai";
import { chunkText } from "./chunk";
import { embedText } from "./embeddings";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

type Supa = any;

type KnowledgeDocInsert = {
  title: string;
  source_type: string; // enum in DB (knowledge_source_type)
  audience?: "internal" | "external" | "both";
  allowed?: boolean;
  category?: string | null;
  series?: string | null;
  membrane?: string | null;
  doc_type?: string | null;
  file_ext?: string | null;
  mime_type?: string | null;
  solution_slug?: string | null;
  status?: string | null; // 'draft' default
  product_tags?: string[];
  created_by?: string | null;
  source_session_id?: string | null;
  storage_path?: string | null;
  source_url?: string | null;
  partner_name?: string | null;
  domain?: string | null;
  is_indexable?: boolean;
  updated_at?: string;
};

type KnowledgeChunkInsert = {
  document_id: string;
  source_type: string; // enum
  audience?: "internal" | "external" | "both";
  content: string;
  embedding: number[];
  chunk_index: number;
  product_tags?: string[];
  token_count?: number | null;
};

type KnowledgeCard = {
  // keep this model simple + map to your schema
  title: string;
  category?: string;
  audience?: "internal" | "external" | "both";
  series?: string | null;
  membrane?: string | null;
  solution_slug?: string | null;
  product_tags?: string[];
  raw_text: string; // becomes chunks.content (NOT stored on knowledge_documents in your schema)
};

const SOURCE_TYPE: string = "anchor"; // ✅ MUST exist in knowledge_source_type enum

export async function ensureChatSession(
  supabase: Supa,
  userId: string,
  sessionId?: string | null
) {
  if (sessionId) {
    const { data } = await supabase
      .from("chat_sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (data?.id) return data.id as string;
  }

  const { data: created, error } = await supabase
    .from("chat_sessions")
    .insert({ user_id: userId, title: "New session" })
    .select("id")
    .single();

  if (error) throw error;
  return created.id as string;
}

export async function writeChatMessage(
  supabase: Supa,
  userId: string,
  sessionId: string,
  role: "user" | "assistant",
  content: string
) {
  const { error } = await supabase.from("chat_messages").insert({
    user_id: userId,
    session_id: sessionId,
    role,
    content,
  });
  if (error) console.error("CHAT_MESSAGE_INSERT_ERROR:", error);
}

export async function maybeSummarizeSession(
  supabase: Supa,
  userId: string,
  sessionId: string
) {
  // summarize when message count is a multiple of 8
  const { count } = await supabase
    .from("chat_messages")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("session_id", sessionId);

  const n = Number(count || 0);
  if (n < 8 || n % 8 !== 0) return;

  const { data: msgs } = await supabase
    .from("chat_messages")
    .select("role,content,created_at")
    .eq("user_id", userId)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(18);

  const ordered = (msgs || []).reverse();
  const transcript = ordered
    .map((m: any) => `${String(m.role).toUpperCase()}: ${m.content}`)
    .join("\n");

  const model = process.env.OPENAI_MODEL || "gpt-5-mini";

  const resp = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          "Summarize this sales training chat for future retrieval. Keep it factual. Output JSON only.",
      },
      {
        role: "user",
        content:
          `Return JSON with keys: summary (string), bullets (string[]), extracted_fields (object with keys like membrane, series, mounting, constraints, next_questions). ` +
          `Chat:\n\n${transcript}`,
      },
    ],
  });

  const txt = resp.output_text || "{}";
  let parsed: any = {};
  try {
    parsed = JSON.parse(txt);
  } catch {
    parsed = { summary: txt.slice(0, 1200), bullets: [], extracted_fields: {} };
  }

  const now = new Date().toISOString();

  const { error } = await supabase
    .from("chat_summaries")
    .upsert(
      {
        user_id: userId,
        session_id: sessionId,
        summary: String(parsed.summary || "").slice(0, 4000),
        bullets: Array.isArray(parsed.bullets) ? parsed.bullets : [],
        extracted_fields: parsed.extracted_fields || {},
        last_message_at: ordered.at(-1)?.created_at ?? now,
        updated_at: now,
      },
      { onConflict: "session_id" }
    );

  if (error) console.error("CHAT_SUMMARY_UPSERT_ERROR:", error);
}

export async function maybeExtractKnowledge(
  supabase: Supa,
  userId: string,
  sessionId: string
) {
  // extract when message count is a multiple of 12
  const { count } = await supabase
    .from("chat_messages")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("session_id", sessionId);

  const n = Number(count || 0);
  if (n < 12 || n % 12 !== 0) return;

  const { data: msgs } = await supabase
    .from("chat_messages")
    .select("role,content,created_at")
    .eq("user_id", userId)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(26);

  const ordered = (msgs || []).reverse();
  const transcript = ordered
    .map((m: any) => `${String(m.role).toUpperCase()}: ${m.content}`)
    .join("\n");

  const model = process.env.OPENAI_MODEL || "gpt-5-mini";

  const resp = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          "Extract reusable Anchor Products sales knowledge from this chat. No guessing. Output JSON only.",
      },
      {
        role: "user",
        content:
          `Create 0-4 knowledge cards. Return JSON array. ` +
          `Each item keys: title (string), raw_text (string fact-only), category (string optional), audience (internal|external|both optional), series (string optional), membrane (string optional), solution_slug (string optional), product_tags (string[] optional). ` +
          `Avoid spec numbers unless explicitly stated in the chat.\n\nChat:\n${transcript}`,
      },
    ],
  });

  const txt = resp.output_text || "[]";
  let cards: KnowledgeCard[] = [];
  try {
    cards = JSON.parse(txt);
  } catch {
    cards = [];
  }

  for (const card of cards.slice(0, 4)) {
    const title = (card.title || "").trim();
    const raw = (card.raw_text || "").trim();
    if (!title || !raw) continue;

    const now = new Date().toISOString();

    // ✅ Insert into YOUR knowledge_documents schema
    const docRow: KnowledgeDocInsert = {
      title,
      source_type: SOURCE_TYPE,
      audience: (card.audience || "both") as any, // default matches DB default
      allowed: true,
      category: (card.category || null) as any,
      series: (card.series ?? null) as any,
      membrane: (card.membrane ?? null) as any,
      solution_slug: (card.solution_slug ?? null) as any,
      product_tags: Array.isArray(card.product_tags) ? card.product_tags : [],
      created_by: userId,
      source_session_id: sessionId,
      is_indexable: true,
      status: "draft", // your default is draft; explicitly set is fine
      updated_at: now,
    };

    const { data: doc, error: docErr } = await supabase
      .from("knowledge_documents")
      .insert(docRow)
      .select("id")
      .single();

    if (docErr || !doc?.id) {
      console.error("KNOWLEDGE_DOC_INSERT_ERROR:", docErr);
      continue;
    }

    // ✅ Chunk + embed => insert into knowledge_chunks schema
    const chunks = chunkText(raw, 900);

    for (let i = 0; i < chunks.length; i++) {
      const content = chunks[i];
      const embedding = await embedText(content);

      const chunkRow: KnowledgeChunkInsert = {
        document_id: doc.id,
        source_type: SOURCE_TYPE,
        audience: (docRow.audience || "both") as any,
        content,
        embedding,
        chunk_index: i,
        product_tags: docRow.product_tags || [],
        token_count: null,
      };

      const { error: chunkErr } = await supabase
        .from("knowledge_chunks")
        .insert(chunkRow);

      if (chunkErr) console.error("KNOWLEDGE_CHUNK_INSERT_ERROR:", chunkErr);
    }
  }
}

/**
 * Optional helper you can use anywhere:
 * Retrieve only "allowed=true" + "is_indexable=true" knowledge via your RPC or retrieve.ts helper.
 * (Keep using your retrieveKnowledge() if that already enforces allowed/indexable.)
 */
export async function retrieveApprovedKnowledge(
  supabase: Supa,
  query: string,
  matchCount = 6
) {
  // If you already have retrieve.ts doing the approved-only logic, use that instead.
  // This function is left here as a convenience if you want it.
  const embedding = await embedText(query);

  const { data, error } = await supabase.rpc("match_knowledge_chunks", {
    query_embedding: embedding,
    match_count: matchCount,
  });

  if (error) {
    console.error("KNOWLEDGE_MATCH_ERROR:", error);
    return [];
  }

  return (data || []) as {
    content: string;
    similarity: number;
    document_id: string;
  }[];
}
