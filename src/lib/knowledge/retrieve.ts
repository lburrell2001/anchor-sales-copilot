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
}
