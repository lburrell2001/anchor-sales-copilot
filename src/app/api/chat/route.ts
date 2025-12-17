// app/api/chat/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

type UserType = "internal" | "external";

type RecommendedDoc = {
  title: string;
  doc_type: string;
  path: string;
  url: string | null;
};

function normalize(s: string) {
  return (s || "").toLowerCase().trim();
}

function detectFolders(message: string) {
  const m = normalize(message);

  const uMatch = m.match(/\bu(\d{4})\b/);
  const uSeries = uMatch ? `u${uMatch[1]}` : null;

  const variants = [
    { key: "epdm", hits: ["epdm"] },
    { key: "kee", hits: ["kee"] },
    { key: "pvc", hits: ["pvc"] },
    { key: "tpo", hits: ["tpo"] },
    { key: "app", hits: ["app"] },
    { key: "sbs", hits: ["sbs"] },
    { key: "sbs-torch", hits: ["torch", "sbs torch", "sbs-torch"] },
    { key: "coatings", hits: ["coating", "coatings"] },
    { key: "plate", hits: ["plate"] },
  ];

  const variant =
    variants.find((v) => v.hits.some((h) => m.includes(h)))?.key || null;

  const solutionHints: Array<{ key: string; hits: string[] }> = [
    { key: "solutions/hvac", hits: ["hvac", "rtu"] },
    { key: "solutions/snow-retention/2pipe", hits: ["2pipe", "two pipe"] },
    { key: "solutions/snow-retention/snow-fence", hits: ["snow fence"] },
    { key: "solutions/satellite-dish", hits: ["satellite", "dish"] },
    { key: "solutions/roof-guardrail", hits: ["guardrail"] },
    { key: "solutions/roof-ladder", hits: ["roof ladder", "ladder"] },
    { key: "solutions/roof-box", hits: ["roof box"] },
    { key: "solutions/solar", hits: ["solar"] },
    { key: "solutions/lightning", hits: ["lightning"] },
  ];

  const solutionFolder =
    solutionHints.find((s) => s.hits.some((h) => m.includes(h)))?.key || null;

  let anchorFolder: string | null = null;
  if (uSeries && variant) anchorFolder = `anchor/u-anchors/${uSeries}/${variant}`;
  else if (uSeries) anchorFolder = `anchor/u-anchors/${uSeries}`;

  return [anchorFolder, solutionFolder].filter(Boolean).slice(0, 2) as string[];
}

async function getDocsForFolder(folder: string) {
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    `http://localhost:${process.env.PORT || 3000}`;

  const res = await fetch(
    `${baseUrl}/api/docs?folder=${encodeURIComponent(folder)}`,
    { cache: "no-store" }
  );

  if (!res.ok) return [];

  const json = await res.json();
  return (json?.files || []) as RecommendedDoc[];
}


export async function POST(req: Request) {
  try {
    const body = await req.json();
    const message = (body?.message || "").trim();
    const userType: UserType = body?.userType === "external" ? "external" : "internal";

    if (!message) {
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    const folders = detectFolders(message);

    const folderDocs = await Promise.all(folders.map(getDocsForFolder));
    const recommendedDocs = folderDocs.flat().slice(0, 10);

    const docContext =
      recommendedDocs.length > 0
        ? recommendedDocs
            .map((d) => `- ${d.doc_type}: ${d.title} (${d.path})${d.url ? ` [${d.url}]` : ""}`)
            .join("\n")
        : "- (No documents matched yet)";

    const system = `
You are "Anchor Sales Co-Pilot" — an expert Sales Engineer for Anchor Products.

Hard rules:
- Do NOT fabricate specs, approvals, compatibility, or install steps.
- If info is missing, ask at most 2 clarifying questions.
- Keep it short, confident, and sales-ready.
- You MUST follow the response format exactly (below).
- You MUST end with "Recommended documents" and only list docs provided in the document list.

Visibility:
- External: no competitor comparisons/details.
- Internal: competitor comparisons only if sources are provided (otherwise say you need sources).

Response format (use these headings exactly):
Recommendation:
- (1–2 bullets)

Why:
- (1–3 bullets)

Need to confirm:
- (0–3 bullets; only if needed)

Quick questions:
1) ...
2) ...

Recommended documents:
- (list doc titles + doc_type; if none matched, say “None matched yet.”)

Provided documents (signed links):
${docContext}
`.trim();

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_MODEL || "gpt-5-mini";

    const resp = await client.responses.create({
      model,
      input: [
        { role: "system", content: system },
        { role: "user", content: `userType=${userType}\n\nQuestion:\n${message}` },
      ],
    });

    const answer = resp.output_text || "I couldn’t generate a response. Please try again.";

    return NextResponse.json({ answer, foldersUsed: folders, recommendedDocs });
  } catch (err: any) {
    console.error("CHAT_ROUTE_ERROR:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
