// src/app/api/chat/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseRoute } from "@/lib/supabase/server";
import { resolveCanonicalSolution } from "@/lib/solutions/resolveCanonicalSolution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------------------------------------------
   Types
--------------------------------------------- */

type RecommendedDoc = {
  title: string;
  doc_type: string;
  path: string;
  url: string | null;
};

type ChatResponse = {
  conversationId?: string;
  answer: string;
  foldersUsed?: string[];
  recommendedDocs?: RecommendedDoc[];
  error?: string;
};

type MsgRole = "system" | "user" | "assistant";
type SimpleMsg = { role: MsgRole; content: string };

type Membrane = "tpo" | "pvc" | "epdm" | null;

type DocsGateContext = {
  membrane: Membrane;
  securing: string | null;
  isExisting: boolean | null;
  raw: string;
};

/* ---------------------------------------------
   Constants
--------------------------------------------- */

const U_ANCHORS_FOLDER = "anchor/u-anchors";

/* ---------------------------------------------
   Helpers
--------------------------------------------- */

function extractUserText(body: any, messages: any[]) {
  const lastUser = [...messages].reverse().find((m) => m?.role === "user");
  return (
    (lastUser?.content ??
      body?.message ??
      body?.input ??
      body?.text ??
      body?.q ??
      "")
      .toString()
      .trim()
  );
}

function anchorContact() {
  return "Contact Anchor Products at (888) 575-2131 or visit anchorp.com.";
}

function formatAnswer(answer: string) {
  return (answer || "").trim();
}

/* ---------------------------------------------
   Guard Helpers
--------------------------------------------- */

function isResidentialIntent(text: string) {
  return /\b(residential|home|house|condo|apartment|homeowner)\b/i.test(text);
}

function isClearlyNotUAnchor(text: string) {
  return /\b(walkway|dunnage)\b/i.test(text);
}

function needsEngineeringEscalation(text: string) {
  return /\b(how many|spacing|layout|pattern|load|uplift|wind|seismic|psf|kpa|torque|fastener|code|ibc|asce|fm|ul)\b/i.test(
    text
  );
}

function containsEngineeringOutput(answer: string) {
  return /\b(\d+\s*(psf|lb|lbs|ft|in|mm)|step\s*\d+|on center|o\.?c\.?)\b/i.test(
    answer
  );
}

/* ---------------------------------------------
   Sanitization
--------------------------------------------- */

function sanitizeAnswer(answer: string) {
  let a = (answer || "").toString();

  a = a.replace(/\b(send|email|text)\b.*\b(doc|docs|pdf|sheet)\b/gi, "");
  a = a.replace(/^\s*(yes|sure|absolutely|of course)\b[,\s:-]*/i, "");
  a = a.replace(/\s{2,}/g, " ").trim();

  return a;
}

/* ---------------------------------------------
   Context Extraction
--------------------------------------------- */

function extractContextForDocsGate(msgs: any[]): DocsGateContext {
  const raw = msgs.map((m) => String(m?.content || "")).join("\n").toLowerCase();

  const membrane =
    raw.includes("tpo") ? "tpo" :
    raw.includes("pvc") ? "pvc" :
    raw.includes("epdm") ? "epdm" :
    null;

  const isExisting =
    /\b(existing|retrofit|tie[-\s]?down|tiedown)\b/.test(raw) ? true :
    /\b(new install|new installation)\b/.test(raw) ? false :
    null;

  const securing =
    /\belevated stack\b/.test(raw) ? "elevated stack" :
    /\bhvac|rtu\b/.test(raw) ? "hvac" :
    /\bpipe|duct|conduit\b/.test(raw) ? "pipe" :
    /\bsolar|panel|pv\b/.test(raw) ? "solar" :
    null;

  return { membrane, securing, isExisting, raw };
}

/* ---------------------------------------------
   Route
--------------------------------------------- */

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const incomingMessages = Array.isArray(body?.messages) ? body.messages : [];
    const userText = extractUserText(body, incomingMessages);

    if (!userText) {
      return NextResponse.json({
        answer: "Please enter a question and try again.",
        foldersUsed: [U_ANCHORS_FOLDER],
      });
    }

    if (isResidentialIntent(userText)) {
      return NextResponse.json({
        answer: formatAnswer(
          `Anchor Sales Co-Pilot supports commercial roofing only. ${anchorContact()}`
        ),
        foldersUsed: [U_ANCHORS_FOLDER],
      });
    }

    if (isClearlyNotUAnchor(userText)) {
      return NextResponse.json({
        answer: formatAnswer(
          "I can help with Anchor rooftop attachment solutions for commercial roofing. What are you securing?"
        ),
        foldersUsed: [U_ANCHORS_FOLDER],
      });
    }

    if (needsEngineeringEscalation(userText)) {
      return NextResponse.json({
        answer: formatAnswer(
          `That requires project-specific engineering review. ${anchorContact()}`
        ),
        foldersUsed: [U_ANCHORS_FOLDER],
      });
    }
            // ---------------------------------------------
// Canonical Solution Short-Circuit
// ---------------------------------------------

const canonical = resolveCanonicalSolution(userText);

if (canonical) {
  return NextResponse.json({
    answer: canonical,
    foldersUsed: [U_ANCHORS_FOLDER],
  });
}
    const supabase = await supabaseRoute();
    const ctx = extractContextForDocsGate(incomingMessages);

    /* ---------------------------------------------
       1) SOLUTION-AWARE RESPONSE (DATA FIRST)
    --------------------------------------------- */

    if (ctx.securing) {
      const { data: solutions } = await supabase
        .from("solution_profiles")
        .select(`
          summary,
          recommended_components,
          products!inner(name)
        `)
        .ilike("products.name", `%${ctx.securing}%`);

      if (solutions && solutions.length > 0) {
        const answer = solutions
          .map(
            (s: any) =>
              `${s.products.name}: ${s.summary} Typically uses ${s.recommended_components}.`
          )
          .join(" ");

        return NextResponse.json({
          answer: sanitizeAnswer(answer),
          foldersUsed: [U_ANCHORS_FOLDER],
        });
      }
    }

    /* ---------------------------------------------
       2) OPENAI FALLBACK (SAFE, HIGH-LEVEL)
    --------------------------------------------- */

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({
        answer: "Server configuration error.",
        error: "Missing OPENAI_API_KEY",
        foldersUsed: [U_ANCHORS_FOLDER],
      });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const system: SimpleMsg = {
      role: "system",
      content: [
        "You are Anchor Sales Co-Pilot.",
        "You support commercial roofing only.",
        "Stay high-level and Anchor-focused.",
        "Do not provide quantities, spacing, loads, installation steps, tools, or code guarantees.",
        "Return the answer only.",
      ].join("\n"),
    };

    const messages: SimpleMsg[] = [
      system,
      ...incomingMessages.map((m: any) => ({
        role: m.role,
        content: String(m.content),
      })),
    ];

    let answer = "";

    try {
      const completion = await openai.responses.create({
        model: process.env.OPENAI_MODEL || "gpt-5-mini",
        input: messages.map((m) => ({
          role: m.role,
          content: [{ type: "input_text", text: m.content }],
        })),
        max_output_tokens: 280,
      });

      answer = completion.output_text || "";
    } catch {
      answer = "";
    }

    if (!answer) {
      answer =
        "Anchor’s rooftop attachment solutions focus on membrane-compatible securement that maintains watertight integrity while supporting long-term performance. The right approach depends on the roof membrane and what’s being secured.";
    }

    answer = sanitizeAnswer(answer);

    if (containsEngineeringOutput(answer)) {
      answer = `That requires project-specific engineering review. ${anchorContact()}`;
    }

    return NextResponse.json({
      answer: formatAnswer(answer),
      foldersUsed: [U_ANCHORS_FOLDER],
    });
  } catch (e: any) {
    return NextResponse.json({
      answer: "Something went wrong. Please try again.",
      error: e?.message || "Unknown error",
      foldersUsed: [U_ANCHORS_FOLDER],
    });
  }
}
