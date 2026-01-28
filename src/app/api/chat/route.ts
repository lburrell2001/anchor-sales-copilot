// src/app/api/chat/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseRoute } from "@/lib/supabase/server";

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

type SiteSnippet = {
  title: string;
  url: string;
  excerpt: string;
};

type ChatResponse = {
  conversationId?: string;
  answer: string; // can be empty for docs-only
  foldersUsed?: string[];
  recommendedDocs?: RecommendedDoc[];
  siteSnippets?: SiteSnippet[];
  error?: string;
};

type MsgRole = "system" | "user" | "assistant";
type SimpleMsg = { role: MsgRole; content: string };

type Membrane = "tpo" | "pvc" | "epdm" | null;

type DocsGateContext = {
  membrane: Membrane;
  securing: string | null; // normalized category (pipe-frame, solar, etc.)
  isExisting: boolean | null; // true=existing/retrofit/tiedown, false=new install, null=unknown
  raw: string; // full convo text
};

type Series = "2000" | "3000" | null;

/* ---------------------------------------------
   Constants
--------------------------------------------- */

// ✅ set this to your REAL storage prefix once
const U_ANCHORS_FOLDER = "anchor/u-anchors";

// “2000 series intents” you provided (single bolt / tiedown group + other known 2000 use cases)
const SERIES_2000_INTENTS = [
  "solar",
  "pv",
  "panel",
  "racking",
  "rail",
  "array",
  "2 pipe",
  "two pipe",
  "snow fence",
  "antenna",
  "elevated stack",
  "roof mounted elevated stack",
  "guy wire",
  "guywire",
  "existing tie down",
  "tie down",
  "tiedown",
  "hvac",
  "rtu",
  "lightning protection",
  "lightning",
  "wall mounted box",
  "wall box",
  "wall mounted guardrail",
  "guardrail",
  "weather station",
  "weather stations",
];

// Helper hint strings for the keyword matcher RPC
const SERIES_HINT_TEXT: Record<Exclude<Series, null>, string> = {
  "2000":
    "single bolt 2000 series u2000 u2400 u2200 tiedown existing retrofit",
  "3000":
    "double bolt 3000 series u3400 u3600 u3200 new installation",
};

/* ---------------------------------------------
   Helpers
--------------------------------------------- */

function getOrigin(req: Request) {
  const h = req.headers;
  const proto = h.get("x-forwarded-proto") || "https";
  const host = h.get("x-forwarded-host") || h.get("host");
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}

function extractUserText(body: any, messages: Array<{ role: string; content: string }>) {
  const lastUser = [...messages].reverse().find((m) => m?.role === "user");
  return (
    (lastUser?.content ?? "").toString().trim() ||
    (body?.message ?? "").toString().trim() ||
    (body?.input ?? "").toString().trim() ||
    (body?.text ?? "").toString().trim() ||
    (body?.q ?? "").toString().trim()
  );
}

function mergeDocsUniqueByPath(...lists: RecommendedDoc[][]) {
  const out: RecommendedDoc[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const d of list || []) {
      const key = (d?.path || "").toString();
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(d);
    }
  }
  return out;
}

function userAskedForDocs(text: string) {
  const t = (text || "").toLowerCase();
  return /\b(doc|docs|document|pdf|file|files|sheet|sheets|manual|install|installation|instructions|cad|dwg|step|stp|drawing|submittal|data\s*sheet|sales\s*sheet|test\s*report)\b/i.test(
    t
  );
}

function looksLikeDocsOnlyRequest(text: string) {
  const t = (text || "").toLowerCase().trim();
  if (!t) return false;

  const docNouns =
    /\b(doc|docs|document|documents|pdf|file|files|sheet|sheets|sales\s*sheet|data\s*sheet|submittal|spec|specs|manual|installation|install|instructions|cad|dwg|step|stp|drawing|drawings|details|test\s*report)\b/;

  const advisory =
    /\b(how|why|difference|compare|recommend|which|best|should i|what do i|help me choose|tell me about|explain)\b/;

  return docNouns.test(t) && !advisory.test(t);
}

function isResidentialIntent(text: string) {
  const t = (text || "").toLowerCase();
  return /\b(residential|home|house|condo|apartment|townhome|single[-\s]?family|multi[-\s]?family|homeowner)\b/i.test(
    t
  );
}

function isUAnchorIntent(text: string) {
  const t = (text || "").toLowerCase();
  return /\bu[-\s]?anchor(s)?\b/.test(t);
}

function isClearlyNotUAnchor(text: string) {
  const t = (text || "").toLowerCase();
  if (isUAnchorIntent(t)) return false;

  // keep this conservative; your copilot may expand later
  const other =
    /\b(walkway|screen|dunnage)\b/i;

  return other.test(t);
}

function needsEngineeringEscalation(text: string) {
  const t = (text || "").toLowerCase();

  const qtySpacing =
    /\b(how\s+many|quantity|qty|count|number\s+of|spacing|pattern|layout|o\.?c\.?|on\s*center)\b/i;

  const loadsCalcs =
    /\b(load|loads|uplift|wind|seismic|psf|kpa|kip|lbs|pounds|newton|calculation|calc|calculate|sizing|size\s+it)\b/i;

  const codeCompliance =
    /\b(code\s*compliance|compliant|meets\s+code|ibc|asce|fm\s*global|ul\s*(listed|classified)?|approval|approved|pe\s*stamp|stamped|sealed)\b/i;

  return qtySpacing.test(t) || loadsCalcs.test(t) || codeCompliance.test(t);
}

function anchorContactBlock() {
  return "Please contact Anchor Products at (888) 575-2131 or online at anchorp.com.";
}

function engineeringEscalationAnswer() {
  return [
    "For final design, sizing, quantities/spacing, loads, or code/compliance questions, this needs Anchor Engineering review.",
    anchorContactBlock(),
  ].join("\n");
}

function residentialRedirectAnswer() {
  return [
    "Anchor Sales Co-Pilot is scoped to commercial roofing for Anchor Products.",
    anchorContactBlock(),
  ].join("\n");
}

function looksTemplated(answer: string) {
  const a = (answer || "").trim();
  if (!a) return false;

  const startsWithHeading =
    /^u-anchors\b/i.test(a) ||
    /^u anchors\b/i.test(a) ||
    /^\*\*u-anchors\*\*/i.test(a) ||
    /^what they are/i.test(a) ||
    /^short answer\b/i.test(a);

  const hasSectionLabels =
    /\b(applications|benefits|components|typical applications|sales view|main components|when to choose|quick context|quick checklist)\b/i.test(
      a
    );

  const bulletHeavy = (a.match(/^\s*[-•]/gm) || []).length >= 6;

  return startsWithHeading || hasSectionLabels || bulletHeavy;
}

function containsEngineeringOutput(answer: string) {
  const t = (answer || "").toLowerCase();

  // Only treat explicit numeric design guidance as “engineering output”
  const numericLoads =
    /\b(\d+(\.\d+)?\s*(psf|kpa|kip|kips|lb|lbs|pounds|n|kn|mph))\b/i;

  const spacingOC =
    /\b(\d+(\.\d+)?\s*(inches|inch|in|ft|feet|mm|cm|m))\b.*\b(o\.?c\.?|on\s*center)\b/i;

  return numericLoads.test(t) || spacingOC.test(t);
}

function toResponsesInput(messages: SimpleMsg[]) {
  return messages.map((m) => ({
    role: m.role,
    content: [{ type: "input_text" as const, text: m.content }],
  }));
}

function safeOutputText(resp: any) {
  if (typeof resp?.output_text === "string" && resp.output_text.trim()) {
    return resp.output_text.trim();
  }

  const chunks: string[] = [];
  const output = Array.isArray(resp?.output) ? resp.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const c of content) {
      if (typeof c?.text === "string") chunks.push(c.text);
      else if (typeof c?.text?.value === "string") chunks.push(c.text.value);
      else if (typeof c?.content === "string") chunks.push(c.content);
    }
  }

  return chunks.join("\n").trim();
}

function sanitizeAnswer(answer: string) {
  let a = (answer || "").toString();

  // Ban weight-language ("light/lighter")
  a = a.replace(/\blighter\b/gi, "");
  a = a.replace(/\blight\b/gi, "");

  // Do not promise to send docs
  a = a.replace(/\b(send|email|text)\b[^.\n]*\b(doc|docs|sheet|manual|cad|drawing|file|pdf)s?\b/gi, "");

  // Don't start with "Yes/Sure/Absolutely/Of course"
  a = a.replace(/^\s*(yes|sure|absolutely|of course)\b[,\s:-]*/i, "");

  // Cleanup
  a = a.replace(/[ \t]+\n/g, "\n");
  a = a.replace(/\n{3,}/g, "\n\n");
  a = a.replace(/\s{2,}/g, " ").trim();

  return a;
}

/**
 * Extract membrane + securing + existing/new across the whole conversation.
 * Docs gate requires membrane + securing.
 */
function extractContextForDocsGate(msgs: Array<{ role: string; content: string }>): DocsGateContext {
  const raw = msgs.map((m) => String(m?.content || "")).join("\n");
  const all = raw.toLowerCase();

  const membrane: Membrane =
    /\btpo\b/.test(all) ? "tpo" :
    /\bpvc\b/.test(all) ? "pvc" :
    /\bepdm\b/.test(all) ? "epdm" :
    null;

  const isExisting =
    /\b(existing|already there|retrofit|replace|re[-\s]?secure|resecure|tie[-\s]?down|tiedown)\b/.test(all) ? true :
    /\b(new|new install|new installation|new construction|planned)\b/.test(all) ? false :
    null;

  // Normalize securing intent (add more keywords as your chats evolve)
  const securing =
    /\b(pipe\s*frame|pipe\s*support|piping|pipe\b|conduit\b|strut\b|unistrut\b|rack\b|rack\s*frame)\b/.test(all) ? "pipe-frame" :
    /\bsolar\b|\bpv\b|\bpanel\b|\bracking\b|\brails?\b|\barray\b/.test(all) ? "solar" :
    /\b2\s*pipe\b|\btwo\s*pipe\b|\bsnow\s*fence\b/.test(all) ? "2-pipe-snow-fence" :
    /\bantenna\b/.test(all) ? "antenna" :
    /\b(elevated\s*stack|roof\s*mounted\s*elevated\s*stack)\b/.test(all) ? "elevated-stack" :
    /\b(guy\s*wire|guywire)\b/.test(all) ? "guy-wire" :
    /\b(existing\s*tie\s*down|tie\s*down|tiedown)\b/.test(all) ? "existing-tiedown" :
    /\b(hvac|rtu|rooftop\s*unit)\b/.test(all) ? "hvac-rtu" :
    /\blightning\b/.test(all) ? "lightning-protection" :
    /\b(wall\s*mounted\s*box|wall\s*box)\b/.test(all) ? "wall-box" :
    /\bguardrail\b/.test(all) ? "guardrail" :
    /\bweather\s*station\b/.test(all) ? "weather-station" :
    /\bsatellite\b|\bdish\b/.test(all) ? "satellite-dish" :
    null;

  return { membrane, securing, isExisting, raw };
}

/**
 * Series inference (your rule + existing tiedown override):
 * - If existing/tiedown: 2000 (single bolt)
 * - Else: 2000 when intent matches your 2000 list; otherwise 3000
 */
function inferSeries(ctx: DocsGateContext): Series {
  const t = (ctx.raw || "").toLowerCase();

  if (ctx.isExisting === true) return "2000";

  const is2000 = SERIES_2000_INTENTS.some((k) => t.includes(k));
  return is2000 ? "2000" : "3000";
}

/* ---------------------------------------------
   Docs fetching (/api/docs indexes the knowledge bucket)
--------------------------------------------- */

async function fetchDocsFromDocsRoute(
  req: Request,
  q: string,
  limit = 12,
  page = 0,
  folder?: string
) {
  const origin = getOrigin(req);
  const docsUrl = new URL(`${origin}/api/docs`);

  if (folder) docsUrl.searchParams.set("folder", folder);
  if (q) docsUrl.searchParams.set("q", q);

  docsUrl.searchParams.set("limit", String(limit));
  docsUrl.searchParams.set("page", String(page));

  const cookie = req.headers.get("cookie") || "";

  const res = await fetch(docsUrl.toString(), {
    method: "GET",
    headers: { cookie },
    cache: "no-store",
  });

  if (!res.ok) return [];
  const json = await res.json().catch(() => null);
  return (json?.docs || []) as RecommendedDoc[];
}

async function fetchDocSnippets(req: Request, q: string, limit = 8): Promise<SiteSnippet[]> {
  const origin = getOrigin(req);

  const docsUrl = new URL(`${origin}/api/docs`);
  docsUrl.searchParams.set("q", q);
  docsUrl.searchParams.set("limit", String(limit));
  docsUrl.searchParams.set("page", "0");

  const cookie = req.headers.get("cookie") || "";

  const res = await fetch(docsUrl.toString(), {
    method: "GET",
    headers: { cookie },
    cache: "no-store",
  });

  if (!res.ok) return [];

  const json = await res.json().catch(() => null);
  const docs = Array.isArray(json?.docs) ? json.docs : [];

  return docs
    .map((d: any) => {
      const title = String(d?.title || d?.name || "").trim();
      const url = String(d?.url || "").trim();
      const excerpt = String(d?.excerpt || d?.snippet || d?.summary || "").trim();
      if (!title) return null;
      return { title, url, excerpt };
    })
    .filter(Boolean)
    .slice(0, limit) as SiteSnippet[];
}

/* ---------------------------------------------
   Minimal persistence helpers (safe)
--------------------------------------------- */

async function getAuthedUserAndMaybeConvoId(req: Request, body: any) {
  try {
    const supabase = await supabaseRoute();
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;
    if (!user) return { supabase: null as any, user: null as any, conversationId: "" };

    let conversationId = String(body?.conversationId || "").trim();

    if (!conversationId) {
      const { data: convo, error: convoErr } = await supabase
        .from("conversations")
        .insert({ user_id: user.id, title: "Anchor Sales Co-Pilot" })
        .select("id")
        .single();

      if (convoErr) return { supabase, user, conversationId: "" };
      conversationId = convo?.id || "";
    }

    return { supabase, user, conversationId };
  } catch {
    return { supabase: null as any, user: null as any, conversationId: "" };
  }
}

async function persistMessage(
  supabase: any,
  userId: string,
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  meta?: any
) {
  try {
    if (!supabase || !userId || !conversationId) return;

    await supabase.from("messages").insert({
      user_id: userId,
      conversation_id: conversationId,
      role,
      content: (content || "").toString(),
      meta: meta && typeof meta === "object" ? meta : {},
    });
  } catch {
    // swallow
  }
}

/* ---------------------------------------------
   Route
--------------------------------------------- */

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const mode = String(body?.mode || "").trim();
    const isDocsMode = mode === "docs";

    const incomingMessages = Array.isArray(body?.messages)
      ? (body.messages as Array<{ role: string; content: string }>)
      : [];

    const userText = extractUserText(body, incomingMessages);
    const foldersUsed: string[] = [U_ANCHORS_FOLDER];

    if (!userText) {
      return NextResponse.json(
        {
          answer: "I didn’t receive your message payload. Please refresh and try again.",
          recommendedDocs: [],
          foldersUsed,
          siteSnippets: [],
        } satisfies ChatResponse,
        { status: 200 }
      );
    }

    const { supabase, user, conversationId } = await getAuthedUserAndMaybeConvoId(req, body);

    if (!isDocsMode && user && conversationId) {
      await persistMessage(supabase, user.id, conversationId, "user", userText);
    }

    /* ---------------------------------------------
       0) Guards
    --------------------------------------------- */

    if (isResidentialIntent(userText)) {
      const answer = residentialRedirectAnswer();

      if (user && conversationId) {
        await persistMessage(supabase, user.id, conversationId, "assistant", answer, {
          type: "residential_redirect",
          foldersUsed,
        });
      }

      return NextResponse.json(
        {
          conversationId: conversationId || body?.conversationId,
          answer,
          recommendedDocs: [],
          foldersUsed,
          siteSnippets: [],
        } satisfies ChatResponse,
        { status: 200 }
      );
    }

    if (isClearlyNotUAnchor(userText)) {
      const answer = [
        "I can help with Anchor rooftop attachment solutions and anchor selection (commercial roofing).",
        "What are you securing, and what membrane are you on (TPO/PVC/EPDM)?",
      ].join("\n");

      if (user && conversationId) {
        await persistMessage(supabase, user.id, conversationId, "assistant", answer, {
          type: "out_of_scope",
          foldersUsed,
        });
      }

      return NextResponse.json(
        {
          conversationId: conversationId || body?.conversationId,
          answer,
          recommendedDocs: [],
          foldersUsed,
          siteSnippets: [],
        } satisfies ChatResponse,
        { status: 200 }
      );
    }

    if (needsEngineeringEscalation(userText)) {
      const answer = engineeringEscalationAnswer();

      if (user && conversationId) {
        await persistMessage(supabase, user.id, conversationId, "assistant", answer, {
          type: "engineering_escalation",
          foldersUsed,
        });
      }

      return NextResponse.json(
        {
          conversationId: conversationId || body?.conversationId,
          answer,
          recommendedDocs: [],
          foldersUsed,
          siteSnippets: [],
        } satisfies ChatResponse,
        { status: 200 }
      );
    }

    /* ---------------------------------------------
       1) Docs gating + fetch
       RULE: Only populate docs AFTER we have BOTH:
         (a) membrane type (TPO/PVC/EPDM) AND
         (b) what they’re securing (pipe frame, solar, etc.)
       - Prefer your pairing table via RPC to pick a folder.
       - Still fallback to keyword search if no folder match.
       - Grounding/snippets to the MODEL only when user asks for docs (prevents doc-pitching).
       - UI Recommended Documents CAN populate once readyForDocs is true (your requirement).
    --------------------------------------------- */

    const ctx = extractContextForDocsGate(incomingMessages);
    const series = inferSeries(ctx);
    const readyForDocs = Boolean(ctx.membrane && ctx.securing);

    let matchedFolder: string | null = null;

    if (readyForDocs && supabase) {
      const hint = series ? SERIES_HINT_TEXT[series] : "";
      const matchText = `${ctx.securing} ${hint} ${ctx.raw} ${userText}`;

      const { data: matches, error } = await supabase.rpc("match_doc_keywords", {
        p_product: "u-anchors",
        p_membrane: ctx.membrane,
        p_text: matchText,
        p_limit: 5,
      });

      if (!error && Array.isArray(matches) && matches.length > 0) {
        matchedFolder = String((matches[0] as any)?.path || "").trim() || null;
      }
    }

    let recommendedDocs: RecommendedDoc[] = [];
    let siteSnippets: SiteSnippet[] = [];

    if (readyForDocs) {
      if (matchedFolder) {
        const folderDocs = await fetchDocsFromDocsRoute(req, "", 20, 0, matchedFolder);
        recommendedDocs = mergeDocsUniqueByPath(folderDocs);
      } else {
        // fallback search (still works even if folder match fails)
        const q1 = `u-anchor ${ctx.membrane} ${ctx.securing}`;
        const q2 = `u anchor ${ctx.membrane} ${ctx.securing}`;
        const q3 = `${ctx.membrane} ${ctx.securing} u-anchor`;

        const [docs1, docs2, docs3] = await Promise.all([
          fetchDocsFromDocsRoute(req, q1, 20, 0),
          fetchDocsFromDocsRoute(req, q2, 20, 0),
          fetchDocsFromDocsRoute(req, q3, 20, 0),
        ]);

        recommendedDocs = mergeDocsUniqueByPath(docs1, docs2, docs3);
      }
    }

    // Grounding/snippets only if user asked for docs AND gate is satisfied
    const includeGrounding = userAskedForDocs(userText) && readyForDocs;

    if (includeGrounding) {
      if (matchedFolder) {
        // Prefer folder-scoped snippets using /api/docs?withText=1
        const origin = getOrigin(req);
        const docsUrl = new URL(`${origin}/api/docs`);
        docsUrl.searchParams.set("folder", matchedFolder);
        docsUrl.searchParams.set("limit", "8");
        docsUrl.searchParams.set("page", "0");
        docsUrl.searchParams.set("withText", "1");
        docsUrl.searchParams.set("excerptLen", "700");

        const cookie = req.headers.get("cookie") || "";
        const res = await fetch(docsUrl.toString(), {
          method: "GET",
          headers: { cookie },
          cache: "no-store",
        });

        if (res.ok) {
          const json = await res.json().catch(() => null);
          const docs = Array.isArray(json?.docs) ? json.docs : [];
          siteSnippets = docs
            .map((d: any) => {
              const title = String(d?.title || "").trim();
              const url = String(d?.url || "").trim();
              const excerpt = String(d?.excerpt || "").trim();
              if (!title) return null;
              return { title, url, excerpt };
            })
            .filter(Boolean)
            .slice(0, 8) as SiteSnippet[];
        }
      } else {
        const qSnip = `u-anchor ${ctx.membrane} ${ctx.securing} ${userText}`;
        siteSnippets = await fetchDocSnippets(req, qSnip, 8);
      }
    }

    // Docs-only mode: respect gating and ask only for missing pieces
    if (isDocsMode || looksLikeDocsOnlyRequest(userText)) {
      const missing: string[] = [];
      if (!ctx.membrane) missing.push("roof membrane (TPO/PVC/EPDM)");
      if (!ctx.securing) missing.push("what you’re securing (pipe frame, solar, RTU tie-down, etc.)");

      const out: ChatResponse = {
        conversationId: conversationId || body?.conversationId,
        answer: readyForDocs ? "" : `I can pull the exact sheets as soon as I have ${missing.join(" and ")}.`,
        recommendedDocs: readyForDocs ? recommendedDocs : [],
        foldersUsed,
        siteSnippets: includeGrounding ? siteSnippets : [],
      };

      if (user && conversationId) {
        await persistMessage(supabase, user.id, conversationId, "assistant", out.answer, {
          type: "docs_only",
          readyForDocs,
          ctx,
          series,
          matchedFolder,
          recommendedDocs: readyForDocs ? recommendedDocs : [],
          foldersUsed,
          siteSnippets: includeGrounding ? siteSnippets : [],
        });
      }

      return NextResponse.json(out, { status: 200 });
    }

    /* ---------------------------------------------
       2) Conversational answer (recommend solution + anchor type)
    --------------------------------------------- */

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        {
          conversationId: conversationId || body?.conversationId,
          answer: "Server is missing OPENAI_API_KEY.",
          recommendedDocs,
          foldersUsed,
          siteSnippets: [],
          error: "Missing OPENAI_API_KEY",
        } satisfies ChatResponse,
        { status: 200 }
      );
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const trimmed: SimpleMsg[] = incomingMessages.slice(-18).map((m) => ({
      role: (m.role as MsgRole) || "user",
      content: (m.content || "").toString(),
    }));

    const system: SimpleMsg = {
      role: "system",
      content: [
        "You are Anchor Sales Co-Pilot — an expert salesperson for Anchor Products.",
        "",
        "NON-NEGOTIABLE SCOPE:",
        "- You work exclusively for Anchor Products.",
        "- You operate ONLY in the commercial roofing industry.",
        "- Assume every job is a commercial roof unless explicitly stated otherwise.",
        "- Never mention residential roofs, homes, homeowners, apartments, condos, or 'residential vs commercial'.",
        "",
        "WHAT TO RECOMMEND (IMPORTANT):",
        "- Do NOT 'recommend U-Anchors' generically — that’s implied.",
        "- Recommend the right SOLUTION / ANCHOR TYPE (series + membrane match) for what they’re securing.",
        "",
        "SERIES LOGIC YOU MAY USE (SALES LEVEL):",
        "- Existing tie-down / retrofit securements: single-bolt approach (2000-series).",
        "- New installations: double-bolt approach (3000-series).",
        "- For pipe/conduit/strut needs: recommend the pipe-frame style solutions and why they fit the use case.",
        "",
        "MEMBRANE MATCH:",
        "- Always match the solution to the named membrane (TPO/PVC/EPDM).",
        "",
        "SAFE FACTS YOU MAY SAY:",
        "- U-Anchors are manufactured from roof membrane material.",
        "- Installed by heat-welding (heat gun + roller) into the membrane system.",
        "- Once welded, the anchor becomes part of the roof membrane/field assembly (not a loose add-on).",
        "",
        "ENGINEERING HARD STOP:",
        "- No calculations, loads, uplift, wind, seismic, spacing, quantities, layouts, or code/approval guarantees.",
        "- No step-by-step installation beyond the general fact they are heat-welded into the membrane.",
        "- If asked for any of the above, direct them to Anchor Engineering at (888) 575-2131 or anchorp.com.",
        "",
        "DOCS UX RULE:",
        "- Do NOT offer to send/email/text documents.",
        "- If the user asks for docs/sheets/manual/CAD/test reports, tell them to click 'See docs' and open Recommended Documents.",
        "",
        "STYLE / TONE:",
        "- Respond conversationally like a real salesperson.",
        "- Lead with the answer first, then 1–2 short follow-ups if needed.",
        "- Do NOT start replies with “Yes/Sure/Absolutely/Of course”.",
        "- Do NOT use headings or a template.",
        "",
        "IF YOU'RE MISSING INFO:",
        "- Still give a sales-level recommendation using what you have.",
        "- Then ask ONE question to fill the biggest gap (usually what they’re securing, or existing vs new, or membrane).",
      ].join("\n"),
    };

    // Give the model the extracted context so it stops re-asking for PVC/TPO/etc.
    const contextSystem: SimpleMsg = {
      role: "system",
      content: [
        "EXTRACTED CONTEXT (use this; do not re-ask if already known):",
        `- membrane: ${ctx.membrane ?? "unknown"}`,
        `- securing: ${ctx.securing ?? "unknown"}`,
        `- existing_installation: ${ctx.isExisting === null ? "unknown" : ctx.isExisting ? "existing/retrofit" : "new install"}`,
        `- suggested_series: ${series ?? "unknown"}`,
      ].join("\n"),
    };

    // Grounding only when user asked for docs (prevents doc-pitching)
    const grounding: SimpleMsg = {
      role: "system",
      content: [
        "DOC RESULTS (titles + snippets) — only use for specific factual claims when present:",
        JSON.stringify(
          {
            matchedFolder: matchedFolder || null,
            docs: (recommendedDocs || []).slice(0, 10).map((d) => ({
              title: d.title,
              doc_type: d.doc_type,
              path: d.path,
              url: d.url,
            })),
            snippets: (siteSnippets || []).map((s) => ({
              title: s.title,
              excerpt: s.excerpt,
            })),
          },
          null,
          2
        ),
      ].join("\n"),
    };

    const messagesForOpenAI: SimpleMsg[] =
      trimmed.length > 0
        ? includeGrounding
          ? [system, contextSystem, grounding, ...trimmed]
          : [system, contextSystem, ...trimmed]
        : includeGrounding
          ? [system, contextSystem, grounding, { role: "user", content: userText }]
          : [system, contextSystem, { role: "user", content: userText }];

    let answer = "";
    let debugError = "";

    // 1) Responses API (omit temperature/presence_penalty for gpt-5-* compatibility)
    try {
      const completion = await openai.responses.create({
        model: process.env.OPENAI_MODEL || "gpt-5-mini",
        input: toResponsesInput(messagesForOpenAI),
        max_output_tokens: 420,
      });

      answer = safeOutputText(completion);
    } catch (err: any) {
      debugError = `responses.create: ${err?.status || ""} ${err?.message || "Unknown error"}`.trim();
      console.error("OPENAI_RESPONSES_ERROR", {
        message: err?.message,
        status: err?.status,
        name: err?.name,
        code: err?.code,
        type: err?.type,
        response: err?.response,
      });
    }

    // 2) Fallback: Chat Completions
    if (!answer) {
      try {
        const completion2 = await openai.chat.completions.create({
          model: process.env.OPENAI_MODEL || "gpt-5-mini",
          messages: messagesForOpenAI.map((m) => ({ role: m.role, content: m.content })),
        });

        answer = completion2.choices?.[0]?.message?.content?.trim() || "";
      } catch (err: any) {
        const e2 = `chat.completions.create: ${err?.status || ""} ${err?.message || "Unknown error"}`.trim();
        debugError = debugError ? `${debugError} | ${e2}` : e2;

        console.error("OPENAI_CHAT_FALLBACK_ERROR", {
          message: err?.message,
          status: err?.status,
          name: err?.name,
          code: err?.code,
          type: err?.type,
          response: err?.response,
        });
      }
    }

    // Deterministic fallback (keep it sales-level, no calcs)
    if (!answer) {
      const mem = ctx.membrane ? ctx.membrane.toUpperCase() : "TPO/PVC/EPDM";
      const sec = ctx.securing || "your rooftop equipment / frame";
      const ser = series === "2000" ? "single-bolt (2000-series)" : series === "3000" ? "double-bolt (3000-series)" : "the right series";
      answer = sanitizeAnswer(
        [
          `For a ${mem} roof and ${sec}, I’d steer you toward a membrane-matched solution with the ${ser} approach.`,
          "The key is that the securement gets heat-welded into the membrane so it becomes part of the roof system—then your frame/equipment attaches to that point.",
          "",
          ctx.securing ? "Is this an existing/retrofit securement or a new install?" : "What are you securing (pipe frame, solar, RTU tie-down, etc.)?",
        ].join("\n")
      );
    } else {
      answer = sanitizeAnswer(answer);
    }

    // Safety backstop
    if (containsEngineeringOutput(answer)) {
      answer = engineeringEscalationAnswer();
    }

    // If it came out templated, do a rewrite pass
    if (!containsEngineeringOutput(answer) && looksTemplated(answer)) {
      try {
        const rewrite = await openai.chat.completions.create({
          model: process.env.OPENAI_MODEL || "gpt-5-mini",
          messages: [
            { role: "system", content: system.content },
            { role: "system", content: contextSystem.content },
            ...(includeGrounding ? [{ role: "system" as const, content: grounding.content }] : []),
            {
              role: "user",
              content:
                "Rewrite the assistant reply below to sound like a natural chat with an experienced commercial roofing customer. " +
                "No headings, no canned sections, do not start with 'Yes/Sure/Absolutely'. Never say 'light/lighter'. Do not offer to send docs.\n\n" +
                `QUESTION:\n${userText}\n\n` +
                `DRAFT ANSWER:\n${answer}`,
            },
          ],
        });

        const rewritten = rewrite.choices?.[0]?.message?.content?.trim();
        if (rewritten) answer = sanitizeAnswer(rewritten);
      } catch {
        // keep original
      }
    }

    // ✅ You wanted it to “offer sheets” once it has membrane + securing.
    // Keep it non-pushy and NEVER promise sending.
    if (readyForDocs && recommendedDocs.length > 0) {
      answer = `${answer}\n\nIf you want the sheets, click See docs to open the Recommended Documents.`;
    }

    if (user && conversationId) {
      await persistMessage(supabase, user.id, conversationId, "assistant", answer, {
        type: "sales_answer",
        readyForDocs,
        ctx,
        series,
        matchedFolder,
        recommendedDocs,
        foldersUsed,
        siteSnippets: includeGrounding ? siteSnippets : [],
        openai_error: debugError || undefined,
      });
    }

    return NextResponse.json(
      {
        conversationId: conversationId || body?.conversationId,
        answer,
        recommendedDocs,
        foldersUsed,
        siteSnippets: includeGrounding ? siteSnippets : [],
        error: debugError || undefined,
      } satisfies ChatResponse,
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        answer: "Something went wrong. Please try again.",
        error: e?.message || "Unknown error",
        recommendedDocs: [],
        foldersUsed: [U_ANCHORS_FOLDER],
        siteSnippets: [],
      } satisfies ChatResponse,
      { status: 200 }
    );
  }
}
