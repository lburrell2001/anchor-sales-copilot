import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function embedText(text: string): Promise<number[]> {
  const model = process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";
  const resp = await client.embeddings.create({
    model,
    input: text.slice(0, 8000),
  });
  return resp.data[0].embedding;
}
