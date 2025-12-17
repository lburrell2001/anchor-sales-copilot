import OpenAI from "openai";

export async function GET() {
  try {
    const key = process.env.OPENAI_API_KEY;

    if (!key) {
      return Response.json({ error: "OPENAI_API_KEY missing" }, { status: 500 });
    }

    const client = new OpenAI({ apiKey: key });

    const response = await client.responses.create({
      model: "gpt-5-mini",
      input: "Say hello as an Anchor Products sales engineer.",
    });

    return Response.json({ text: response.output_text });
  } catch (err: any) {
    return Response.json(
      {
        error: err?.message ?? "Unknown error",
        name: err?.name,
        status: err?.status,
      },
      { status: 500 }
    );
  }
}
