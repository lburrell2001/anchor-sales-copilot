// src/app/api/chat/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { resolveCanonicalSolution } from "@/lib/solutions/resolveCanonicalSolution";
import { CANONICAL_SOLUTIONS, type CanonicalSolution } from "@/lib/solutions/canonicalSolutions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RecommendedDoc = {
  title: string;
  doc_type: string;
  path: string;
  url: string | null;
  excerpt?: string;
};

type ChatMsg = { role: "user" | "assistant"; content: string };

type ChatResponse = {
  conversationId?: string;
  sessionId?: string;
  answer: string;
  foldersUsed?: string[];
  recommendedDocs?: RecommendedDoc[];
  sourcesUsed?: any[]; // optional if you later add it
  error?: string;
};

const U_ANCHORS_FOLDER = "anchor/u-anchors";
const WRAP_UP_PHRASES = [
  "If you want, I can pull the install and data sheets for this setup.",
  "I can grab the install + data sheets whenever you’re ready.",
  "Want me to pull the install and spec sheets for this configuration?",
];
const FALLBACK_SYSTEM_PROMPT = `
You are Anchor Sales Co-Pilot for Anchor Products (commercial rooftop attachment solutions only).
Reply like a confident sales engineer. Lead with a recommendation, then explain briefly.
Ask at most one clarifying question only if it materially changes the solution.
Do NOT provide engineering calculations, spacing, loads, or code guidance.
`.trim();
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";
const FALLBACK_MODEL = process.env.OPENAI_FALLBACK_MODEL || "gpt-4.1-mini";

type DocPreference = "solution" | "anchor_membrane" | "both" | null;

function getOrigin(req: Request) {
  const h = req.headers;
  const proto = h.get("x-forwarded-proto") || "https";
  const host = h.get("x-forwarded-host") || h.get("host");
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}

function anchorContact() {
  return "Contact Anchor Products at (888) 575-2131 or visit anchorp.com.";
}

/**
 * Safer sanitizing:
 * - Remove only sentences that claim to send/email/text docs.
 * - Avoid greedy wipes that can delete the entire answer.
 */
function sanitizeAnswer(answer: string) {
  const original = (answer || "").toString();
  let a = original;

  a = a.replace(
    /[^.?!]*(\b(send|email|text)\b)[^.?!]*(\b(doc|docs|pdf|sheet|sheets)\b)[^.?!]*[.?!]/gi,
    ""
  );

  a = a.replace(/^\s*(yes|sure|absolutely|of course)\b[,\s:-]*/i, "");
  a = a.replace(/\s{2,}/g, " ").trim();

  // If sanitizing wiped the response, fall back to the original to avoid empty replies.
  return a || original.trim();
}

function containsEngineeringOutput(answer: string) {
  // Trigger only on explicit engineering specifics (numbers, spacing, torque, schedules).
  return /\b(\d+(\.\d+)?\s*(psf|lb|lbs|kpa|ft|in|mm)|on center|o\.?c\.?|torque|fastener\s*schedule|fastening\s*schedule|spacing)\b/i.test(
    answer
  );
}

function needsEngineeringEscalation(text: string) {
  const t = String(text || "");
  // Only escalate on explicit engineering asks or numeric/code-driven requests.
  if (/\b(how many|spacing|layout|pattern|torque|fastener|code|ibc|asce|fm|ul)\b/i.test(t)) {
    return true;
  }
  // For wind/uplift/load/seismic, require calculation intent or units.
  if (/\b(wind|uplift|load|seismic)\b/i.test(t)) {
    return /\b(calc|calculate|rating|psf|kpa|mph|pressure|design)\b/i.test(t);
  }
  return false;
}

function extractMembrane(text: string) {
  const t = String(text || "").toLowerCase();
  if (/\btpo\b/.test(t)) return "tpo";
  if (/\bpvc\b/.test(t)) return "pvc";
  if (/\bepdm\b/.test(t)) return "epdm";
  if (/\bkee\b/.test(t)) return "kee";
  if (/\bsbs\b/.test(t)) return "sbs";
  if (/\bapp\b/.test(t)) return "app";
  if (/\bmod(?:ified)?\s*bit\b|\bmod[-\s]?bit\b/.test(t)) return "modified bitumen";
  if (/\bsilicone\b/.test(t)) return "silicone";
  if (/\bacrylic\b/.test(t)) return "acrylic";
  return null;
}

function extractAnchorSeries(text: string) {
  const t = String(text || "").toLowerCase();
  if (/\b2000\s*series\b|\bseries\s*2000\b|\b2000s\b/.test(t)) return "2000-series";
  if (/\b3000\s*series\b|\bseries\s*3000\b|\b3000s\b/.test(t)) return "3000-series";
  const uMatch = t.match(/\bu\s?\d{3,4}\b/);
  return uMatch ? uMatch[0].replace(/\s+/g, "") : null;
}

function extractMountSurface(text: string) {
  const t = String(text || "").toLowerCase();
  const mentionsWall = /\b(wall|parapet|vertical)\b/.test(t);
  const mentionsRoof = /\b(roof|rooftop)\b/.test(t);
  if (mentionsWall && !mentionsRoof) return "wall";
  if (mentionsRoof) return "roof";
  return null;
}

function extractCondition(text: string) {
  const t = String(text || "").toLowerCase();
  if (/\b(existing|retrofit|re[-\s]?secure|re[-\s]?tie|tie[-\s]?down)\b/.test(t)) return "existing / re-secure";
  if (/\bnew|new install\b/.test(t)) return "new install";
  return null;
}

function buildConversationMemory(messages: ChatMsg[]) {
  const allText = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
  const membrane = extractMembrane(allText);
  const anchorSeries = extractAnchorSeries(allText);
  const mountSurface = extractMountSurface(allText);
  const condition = extractCondition(allText);

  const mem: Record<string, string> = {};
  if (membrane) mem.membrane = membrane.toUpperCase();
  if (anchorSeries) mem.anchor_series = anchorSeries;
  if (mountSurface) mem.mount_surface = mountSurface;
  if (condition) mem.condition = condition;

  return mem;
}

function findCanonicalSolutionByFolder(folderHint?: string | null): CanonicalSolution | null {
  if (!folderHint) return null;
  const clean = String(folderHint).replace(/^solutions\//, "").trim();
  return (
    CANONICAL_SOLUTIONS.find((s) => s.storageFolder === folderHint) ||
    CANONICAL_SOLUTIONS.find((s) => s.securing === clean) ||
    null
  );
}

function humanizeSolutionLabel(folderHint?: string | null, solution?: CanonicalSolution | null) {
  const key = solution?.securing || String(folderHint || "").replace(/^solutions\//, "");
  const map: Record<string, string> = {
    "hvac": "mechanical tie-down / HVAC securement",
    "guy-wire-kit": "guy wire tie-down",
    "pipe-frame/attached": "attached pipe-frame (roof-mounted H-frame)",
    "pipe-frame/existing": "existing pipe-frame tie-down",
    "duct-securement": "duct securement",
    "roof-box": "roof box",
    "wall-box": "wall box",
    "equipment-screen": "equipment screen / signage",
    "signage": "equipment screen / signage",
    "lightning": "lightning protection attachment",
    "light-mount": "light mount",
    "camera-mount": "camera mount",
    "antenna": "antenna mount",
    "satellite-dish": "satellite dish mount",
    "weather-station": "weather station mount",
    "roof-guardrail": "roof guardrail",
    "wall-guardrail": "wall guardrail",
    "roof-ladder": "roof ladder",
    "roof-pipe": "roof pipe support",
    "roof-pipe/adjustable": "adjustable roof pipe support",
    "roof-pipe/double": "double roof pipe support",
    "roof-pipe/roller": "roller roof pipe support",
    "roof-pipe/single": "single roof pipe support",
    "elevated-stack/roof-stack": "roof stack",
    "elevated-stack/wall-stack": "wall stack",
    "elevated-stack": "elevated stack",
    "snow-retention/2-pipe-snow-fence": "2-pipe snow fence",
    "snow-retention/unitized-snow-fence": "unitized snow fence",
    "snow-retention": "snow retention",
    "solar": "solar racking attachment",
  };

  return map[key] || "rooftop attachment solution";
}

function detectWrapUp(answerText: string) {
  // Wrap-up detector: exact-intent phrases required by product rules.
  const t = String(answerText || "").toLowerCase();
  return WRAP_UP_PHRASES.some((p) => t.includes(p.toLowerCase()));
}

function userAskedForDocs(text: string) {
  return /\b(send|pull|grab|share|provide|email|text|download|get)\b.*\b(sheet|sheets|manual|data\s*sheet|spec\s*sheet|specs|install|documentation|docs|pdf)\b/i.test(
    text
  );
}

function userAgreed(text: string) {
  return /\b(yes|yep|yeah|sure|ok|okay|please|go ahead|sounds good|do it)\b/i.test(text);
}

function hasMembrane(text: string) {
  return /\b(tpo|pvc|epdm|sbs|app|kee|modified|mod[-\s]?bit|coating|silicone|acrylic)\b/i.test(
    text
  );
}

function hasAnchorSeries(text: string) {
  return /\b(2000[-\s]?series|3000[-\s]?series|series\s*2000|series\s*3000)\b/i.test(text);
}

function detectDocPreference(text: string): DocPreference {
  const t = String(text || "").toLowerCase();
  if (/\bboth\b/.test(t)) return "both";
  if (/\bsolution\b.*\b(sheet|sheets|docs|documentation)\b/.test(t)) return "solution";
  if (/\banchor\b.*\bmembrane\b/.test(t)) return "anchor_membrane";
  if (/\bmembrane[-\s]?specific\b|\banchor[-\s]?membrane\b/.test(t)) return "anchor_membrane";
  return null;
}

function isDocRequestOnly(text: string) {
  const t = String(text || "").toLowerCase().trim();
  if (!t) return false;
  return /\b(solution\s*sheets?|install\s*sheet|install\s*manual|data\s*sheet|spec\s*sheet|docs|documentation|pdfs?)\b/.test(
    t
  );
}

function shouldReturnDocs(params: {
  lastUser: string;
  transcript: string;
  answer: string;
  folderHint?: string;
  docPreference: DocPreference;
}) {
  const { lastUser, transcript, answer, folderHint, docPreference } = params;

  // Docs are returned if the user chose the doc type AND we have a solution folder.
  const hasSolution = Boolean(folderHint);

  // If the user asked for docs but didn't choose the type, do NOT return yet.
  if (!docPreference) return false;

  // If we have preference and a solution bucket, return docs now (no extra blocking).
  if (hasSolution) return true;

  // If current answer contains wrap-up, we still do NOT return docs until the next user turn.
  if (detectWrapUp(answer)) return false;

  return false;
}


function ensureNonEmptyAnswer(params: {
  answer: string;
  userText: string;
  transcript?: string;
  folderHint?: string | null;
  solution?: CanonicalSolution | null;
}) {
  let a = String(params.answer || "").trim();

  // Minimal non-empty safeguard only; no templated fallback.
  if (!a) {
    return "I’m not getting a response from the model right now. Please try again.";
  }

  return a;
}

function normalizeBulletSpacing(answer: string) {
  let a = String(answer || "");
  // Ensure bullets start on their own line.
  a = a.replace(/([^\n])\s*•\s+/g, "$1\n• ");
  // Normalize common hyphen bullets to "•" and put them on new lines.
  a = a.replace(/([^\n])\s*-\s+/g, "$1\n• ");
  // Ensure a blank line before the first bullet list for readability.
  a = a.replace(/([^\n])\n(•\s+)/g, "$1\n\n$2");
  // Ensure a blank line between recommendation and bullet list when bullets exist.
  a = a.replace(/([^\n])\n\n(•\s+)/g, "$1\n\n$2");
  // Collapse accidental double spaces.
  a = a.replace(/[ \t]{2,}/g, " ");
  return a.trim();
}

async function fetchDocs(
  req: Request,
  opts: {
    q?: string;
    folder?: string;
    limit?: number;
    page?: number;
    withText?: boolean;
    excerptLen?: number;
    visibility?: "public" | "all";
  }
) {
  const origin = getOrigin(req);
  const url = new URL(`${origin}/api/docs`);

  if (opts.folder) url.searchParams.set("folder", opts.folder);
  if (opts.q) url.searchParams.set("q", opts.q);
  if (opts.visibility) url.searchParams.set("visibility", opts.visibility);

  url.searchParams.set("limit", String(opts.limit ?? 8));
  url.searchParams.set("page", String(opts.page ?? 0));
  url.searchParams.set("withText", opts.withText === false ? "0" : "1");
  url.searchParams.set("excerptLen", String(opts.excerptLen ?? 900));

  const cookie = req.headers.get("cookie") || "";
  const res = await fetch(url.toString(), { method: "GET", headers: { cookie }, cache: "no-store" });
  if (!res.ok) return [] as RecommendedDoc[];

  const json = await res.json().catch(() => null);
  return (json?.docs || []) as RecommendedDoc[];
}

function buildDocsContext(docs: RecommendedDoc[]) {
  if (!docs.length) return "";
  return docs
    .slice(0, 8)
    .map((d, i) => {
      const excerpt = (d.excerpt || "").trim().slice(0, 900);
      return `[#${i + 1}] ${d.title}\nPath: ${d.path}\nType: ${d.doc_type}\nSnippet: ${excerpt || "(No snippet)"}\n`;
    })
    .join("\n---\n");
}

/**
 * Robustly extract text from OpenAI Responses API output.
 */
function extractResponsesText(resp: any): string {
  const direct = (resp?.output_text || "").toString().trim();
  if (direct) return direct;

  const pieces: string[] = [];
  const output = Array.isArray(resp?.output) ? resp.output : [];

  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const c of content) {
      // most common: { type: "output_text", text: "..." }
      if (typeof c?.text === "string" && c.text.trim()) pieces.push(c.text.trim());
      else if (typeof c?.value === "string" && c.value.trim()) pieces.push(c.value.trim());
      else if (typeof c?.refusal === "string" && c.refusal.trim()) pieces.push(c.refusal.trim());
    }
  }

  return pieces.join("\n").trim();
}

// “Custom GPT” rules as one system prompt
const SYSTEM_PROMPT = `
You are Anchor Sales Co-Pilot for Anchor Products, a commercial roofing attachment manufacturer.

Your role:
- Help sales reps, contractors, and internal teams recommend the correct Anchor rooftop attachment solution.
- Speak like an experienced Anchor sales engineer: confident, natural, and practical.
- Use common industry naming conventions and recognize that customers may describe the same solution in multiple ways.

Tone & style:
- Answer like ChatGPT: conversational, confident, and helpful.
- Never robotic, never templated.
- Do not ask unnecessary questions or repeat information the user already provided.
- Sound like an expert Anchor Products sales engineer: practical, decisive, and product-specific.
- Use short, sales-ready sentences. Prefer “go-to / standard / typical Anchor approach” phrasing.

Response pattern (always follow):
1. Lead with a clear recommendation in 1–3 sentences.
2. Follow with 3–6 bullet points explaining what the solution is, when it’s used, and what components are typically involved.
3. Use bullet points that start with "•" (not hyphens).
4. Ask at most ONE clarifying question, only if it materially affects the solution (example: roof-mounted vs wall-mounted).
5. Do NOT ask for dimensions or measurements unless the user explicitly requests engineering review.

Critical guardrails:
- Do NOT provide spacing, layout, patterns, load calculations, torque values, fastening schedules, or code guarantees.
- If engineering-specific details are requested, state that the project requires engineering review and direct the user to Anchor Products.
- Assume all projects are commercial roofing unless explicitly stated otherwise.

System-wide rules:
- All anchors are matched based on the roof membrane type (TPO, PVC, EPDM, etc.).
- Guy wire kits ONLY use 2000-series anchors.
- All solutions that use guy wire kits are tie-down solutions.
- Use conversation context: if the user provides partial info (ex: “TPO roof”), do not reset the conversation.
- Anchor Products supports commercial membrane-covered roofs only.
- Anchor bases are manufactured from the specified membrane type (TPO, PVC, EPDM, KEE, APP, SBS, SBS-torch). Coatings are custom anchor colors.
- Treat any "Conversation memory" block as confirmed facts and do not re-ask for those details.

--------------------------------------------------
ANCHOR SOLUTION MAPPING & NAMING CONVENTIONS
--------------------------------------------------

Solar
- Common names: solar, PV, photovoltaic, solar panels, racking
- Typical solution: 2000-series anchors with strut framing
- Securing: solar

Snow Retention
- 2-Pipe Snow Fence
  - Also called: two-pipe snow fence
  - 2000-series anchors, piping, splices
  - Securing: snow-retention/2-pipe-snow-fence
- Unitized Snow Fence
  - Also called: snow fence panels, unitized fence
  - 3000-series anchors with rigid fence panels
  - Securing: snow-retention/unitized-snow-fence

Roof-Mounted Box
- Also called: rooftop enclosure, equipment box
- 2000-series anchors with strut framing
- Securing: roof-box

Wall-Mounted Box
- Also called: parapet box, wall enclosure
- 3000-series anchors with strut framing
- Securing: wall-box

Electrical Disconnect
- Also called: electrical box, service disconnect
- 2000-series anchors with strut framing
- Securing: electrical-disconnect

Roof Pipe Securement
- Also called: pipe supports, rooftop piping
- 3000-series anchors
- Securing: roof-pipe (adjustable, single, double, or roller variants)

Roof-Mounted H-Frame
- Also called: attached pipe frame, roof-mounted H-frame
- 3000-series anchors with strut framing
- Securing: pipe-frame/attached

Existing Pipe or Duct
- Also called: existing frame, re-secure, retrofit
- Guy wire kit with 2000-series anchors
- Tie-down solution
- Securing: pipe-frame/existing or duct-securement

Existing Mechanical Tie-Down
- Also called: hvac
- Guy wire kit with 2000-series anchors
- Tie-down solution
- Securing: pipe-frame/existing

Guardrails
- Roof-Mounted Guardrail
  - 3000-series anchors
  - Securing: roof-guardrail
- Wall-Mounted Guardrail
  - 3000-series anchors
  - Securing: wall-guardrail

Roof Ladder
- 3000-series anchors with adjustable strut bracket
- Securing: roof-ladder

Weather Stations
- Also called: rooftop sensors, monitoring stations
- Guy wire kit with 2000-series anchors
- Tie-down solution
- Securing: weather-station

Satellite Dish
- Also called: dish, satellite antenna
- 2000-series anchors
- Securing: satellite-dish

Antenna
- Also called: communication antenna, RF antenna
- Guy wire kit with 2000-series anchors
- Tie-down solution
- Securing: antenna

Equipment Screen
- Also called: rooftop screen, visual screen
- 2000-series anchors with strut framing
- Typically secured the same way as signage
- Securing: equipment-screen

Signage
- Also called: rooftop sign, branded signage
- 2000-series anchors
- Typically secured the same way as equipment screens
- Securing: signage

Light Mount
- Also called: lighting mount, area light, flood light
- 3000-series anchors
- Typically secured the same way as camera mounts
- Securing: light-mount

Camera Mount
- Also called: security camera, surveillance camera
- 3000-series anchors
- Typically secured the same way as light mounts
- Securing: camera-mount

Elevated Stack
- Roof-Mounted Elevated Stack
  - Guy wire kit with 2000-series anchors
  - Tie-down solution
  - Securing: elevated-stack/roof-stack
- Wall-Mounted Elevated Stack
  - 2000-series anchors with strut framing
  - Securing: elevated-stack/wall-stack

Lightning Protection
- Also called: lightning arrestor, lightning rod system
- 2000-series anchors
- Securing: lightning

--------------------------------------------------
FINAL BEHAVIOR
--------------------------------------------------

- Recognize multiple names for the same solution.
- Default to the most common Anchor solution unless the user specifies otherwise.
- Ask clarifying questions only when absolutely necessary.
- Always keep responses aligned with Anchor Products’ real-world practices and product families.

`.trim();

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const incoming: ChatMsg[] = Array.isArray(body?.messages)
      ? body.messages
          .filter((m: any) => m?.role && m?.content)
          .map((m: any) => ({
            role: m.role,
            content: String(m.content || ""),
          }))
      : [];

    const lastUser =
      [...incoming].reverse().find((m) => m.role === "user")?.content?.trim() || "";

    if (!lastUser) {
      return NextResponse.json({
        answer:
          "Tell me what you’re securing and what roof membrane you’re on (TPO/PVC/EPDM), and I’ll recommend the right Anchor solution.",
        foldersUsed: [U_ANCHORS_FOLDER],
        recommendedDocs: [],
      } satisfies ChatResponse);
    }

    // engineering escalation
    if (needsEngineeringEscalation(lastUser)) {
      return NextResponse.json({
        answer: `That requires project-specific engineering review. ${anchorContact()}`,
        foldersUsed: [U_ANCHORS_FOLDER],
        recommendedDocs: [],
      } satisfies ChatResponse);
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        {
          answer: "Server configuration error.",
          error: "Missing OPENAI_API_KEY",
          foldersUsed: [U_ANCHORS_FOLDER],
          recommendedDocs: [],
        } satisfies ChatResponse,
        { status: 500 }
      );
    }

    const intentText = `${incoming.map((m) => m.content).join("\n")}\n${lastUser}`;
    const folderHint = resolveCanonicalSolution(intentText) || undefined;
    const canonicalSolution = findCanonicalSolutionByFolder(folderHint);
    const memory = buildConversationMemory(incoming);
    const memoryBlock =
      Object.keys(memory).length > 0
        ? `Conversation memory (confirmed facts):\n${Object.entries(memory)
            .map(([k, v]) => `- ${k}: ${v}`)
            .join("\n")}`
        : "";

    const transcript = incoming.map((m) => `${m.role}: ${m.content}`).join("\n");

    const docPreference = detectDocPreference(lastUser) || detectDocPreference(transcript);
    const shouldDocs = shouldReturnDocs({
      lastUser,
      transcript,
      answer: "",
      folderHint,
      docPreference,
    });

    const membrane = extractMembrane(transcript) || extractMembrane(lastUser);
    const anchorSeries = extractAnchorSeries(transcript) || extractAnchorSeries(lastUser);
    const visibility = body?.userType === "external" ? "public" : "all";

    // Docs are only returned when the user asks or the solution is finalized.
    // This keeps the chat flow conversational and avoids premature attachments.
    let recommendedDocs: RecommendedDoc[] = [];
    if (shouldDocs && docPreference) {
      const suppressQ = isDocRequestOnly(lastUser);
      if (docPreference === "solution" || docPreference === "both") {
        const solutionDocs = await fetchDocs(req, {
          folder: folderHint,
          q: suppressQ ? undefined : lastUser,
          limit: 8,
          withText: true,
          excerptLen: 900,
          visibility,
        });
        recommendedDocs = recommendedDocs.concat(solutionDocs);
      }
      if (docPreference === "anchor_membrane" || docPreference === "both") {
        const anchorQuery = [anchorSeries, membrane].filter(Boolean).join(" ");
        const anchorDocs = await fetchDocs(req, {
          folder: U_ANCHORS_FOLDER,
          q: anchorQuery || (suppressQ ? undefined : lastUser),
          limit: 8,
          withText: true,
          excerptLen: 900,
          visibility,
        });
        recommendedDocs = recommendedDocs.concat(anchorDocs);
      }
      // de-dupe by path
      const seen = new Set<string>();
      recommendedDocs = recommendedDocs.filter((d) => {
        if (seen.has(d.path)) return false;
        seen.add(d.path);
        return true;
      });
    }

    const docsContext = shouldDocs ? buildDocsContext(recommendedDocs) : "";

    const finalized = Boolean(folderHint) && (hasMembrane(transcript) || hasAnchorSeries(transcript));
    const needsDocChoice = finalized && !docPreference;
    const askedForDocs = userAskedForDocs(lastUser) || Boolean(docPreference);
    const userPrompt = [
      folderHint ? `Detected storage folder hint: ${folderHint}` : "",
      // Keep internal docs out of the chat response. We use them for grounding, not verbatim output.
      docsContext ? `Internal doc snippets (for grounding only; do NOT quote or mention these):\n${docsContext}` : "",
      memoryBlock,
      `Conversation so far:\n${transcript}`,
      needsDocChoice
        ? `If the solution is finalized, add this as a final question after the recommendation and bullets: "Want the solution sheets, the membrane-specific anchor sheets, or both?"`
        : "",
      askedForDocs
        ? `The user asked for sheets. If the solution is known, confirm you'll provide them now.`
        : "",
      `Now answer the user's latest message.`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // ✅ IMPORTANT: Use Responses API with correctly typed content parts
    const resp = await openai.responses.create({
      model: DEFAULT_MODEL,
      max_output_tokens: 650,
      // Force text output and minimize reasoning-only responses.
      reasoning: { effort: "minimal" },
      text: { format: { type: "text" }, verbosity: "low" },
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: SYSTEM_PROMPT }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: userPrompt }],
        },
      ],
    });
    const extractedPrimary = extractResponsesText(resp);
    let answer = sanitizeAnswer(extractedPrimary);

    // guardrail
    if (containsEngineeringOutput(answer)) {
      answer = `That requires project-specific engineering review. ${anchorContact()}`;
    }

    // If OpenAI returns no text, retry once with a shorter prompt to avoid empty/template responses.
    if (!answer) {
      const retry = await openai.responses.create({
        model: DEFAULT_MODEL,
        max_output_tokens: 650,
        reasoning: { effort: "minimal" },
        text: { format: { type: "text" }, verbosity: "low" },
        input: [
          { role: "system", content: [{ type: "input_text", text: FALLBACK_SYSTEM_PROMPT }] },
          { role: "user", content: [{ type: "input_text", text: `Conversation:\n${transcript}\n\nUser: ${lastUser}` }] },
        ],
      });
      const extractedRetry = extractResponsesText(retry);
      answer = sanitizeAnswer(extractedRetry);
    }

    // Final fallback: if still empty, try a proven text model.
    if (!answer) {
      const fallback = await openai.responses.create({
        model: FALLBACK_MODEL,
        max_output_tokens: 650,
        reasoning: { effort: "minimal" },
        text: { format: { type: "text" }, verbosity: "low" },
        input: [
          { role: "system", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
          { role: "user", content: [{ type: "input_text", text: userPrompt }] },
        ],
      });
      const extractedFallback = extractResponsesText(fallback);
      answer = sanitizeAnswer(extractedFallback);
    }

    // Ensure non-empty response in case OpenAI returns no text.
    answer = ensureNonEmptyAnswer({
      answer,
      userText: lastUser,
      transcript,
      folderHint,
      solution: canonicalSolution,
    });

    // Normalize bullet spacing so lists render as separate lines in the chat UI.
    answer = normalizeBulletSpacing(answer);

    // No forced wrap-up phrasing; keep responses freeform.

    return NextResponse.json({
      answer,
      foldersUsed: [U_ANCHORS_FOLDER, ...(folderHint ? [folderHint] : [])],
      recommendedDocs,
      sessionId: body?.sessionId || undefined,
      conversationId: body?.conversationId || undefined,
    } satisfies ChatResponse);
  } catch (e: any) {
    return NextResponse.json(
      {
        answer: "Something went wrong. Please try again.",
        error: e?.message || "Unknown error",
        foldersUsed: [U_ANCHORS_FOLDER],
        recommendedDocs: [],
      } satisfies ChatResponse,
      { status: 500 }
    );
  }
}
