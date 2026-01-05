<<<<<<< HEAD
import { embedText } from "@/lib/learning/embeddings";

type Supa = any;

export type RetrievedChunk = {
  chunk_id: string;
  document_id: string;
  title: string | null;
  content: string;
  similarity: number;
  feedback_score?: number;
  downvotes?: number;
};

export async function retrieveKnowledge(
  supabase: Supa,
  query: string,
  opts?: { matchCount?: number }
): Promise<RetrievedChunk[]> {
  const matchCount = opts?.matchCount ?? 6;
  const embedding = await embedText(query);

  const { data, error } = await supabase.rpc("match_knowledge_chunks", {
    query_embedding: embedding,
    match_count: matchCount,
  });

  if (error) {
    console.error("retrieveKnowledge RPC error:", error);
    return [];
  }

  return (data || []) as RetrievedChunk[];
=======
import { embed } from "@/lib/knowledge/embeddings";

export async function retrieveKnowledge(
  supabase: any,
  query: string,
  opts?: { matchCount?: number; category?: string | null; productTags?: string[] | null }
) {
  const queryEmbedding = await embed(query);

  const { data, error } = await supabase.rpc("match_knowledge_chunks", {
    query_embedding: queryEmbedding,
    match_count: opts?.matchCount ?? 8,
    filter_category: opts?.category ?? null,
    filter_product_tags: opts?.productTags ?? null,
  });

  if (error) throw error;
  return (data || []) as { id: string; document_id: string; content: string; similarity: number }[];
>>>>>>> 7500f79 (Monday changes)
}
