// src/app/api/chat/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseRoute } from "@/lib/supabase/server";
import { retrieveKnowledge } from "@/lib/knowledge/retrieve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UserType = "internal" | "external";

type RecommendedDoc = {
  title: string;
  doc_type: string;
  path: string;
  url: string | null;
};

type MsgRow = {
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

type ProfileRole = "admin" | "anchor_rep" | "external_rep";

type ProfileRow = {
  email: string | null;
  user_type: UserType | null;
  role: ProfileRole | null;
};

/* ---------------------------------------------
   Helpers
--------------------------------------------- */

function normalize(s: string) {
  return (s || "").toLowerCase().trim();
}

function getBaseUrl(req: Request) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  if (!host) throw new Error("Missing host header");
  return `${proto}://${host}`;
}

function deriveAccessFromEmail(emailRaw: string | null | undefined) {
  const email = (emailRaw || "").trim().toLowerCase();
  const isInternal = email.endsWith("@anchorp.com");
  const user_type: UserType = isInternal ? "internal" : "external";
  const role: ProfileRole = isInternal ? "anchor_rep" : "external_rep";
  return { email, user_type, role };
}

/**
 * ✅ Forward cookies safely (don’t overwrite multiple Set-Cookie headers).
 * Next's Headers has getSetCookie() in some runtimes; fall back to raw header.
 */
function forwardCookies(base: Response, out: NextResponse) {
  const anyHeaders = base.headers as any;

  const setCookies: string[] | null =
    typeof anyHeaders.getSetCookie === "function" ? anyHeaders.getSetCookie() : null;

  if (setCookies && setCookies.length) {
    for (const c of setCookies) out.headers.append("set-cookie", c);
    return out;
  }

  const sc = base.headers.get("set-cookie");
  if (sc) out.headers.append("set-cookie", sc);

  return out;
}

/** ✅ OpenAI latency helper */
function msSince(start: bigint) {
  const diff = process.hrtime.bigint() - start; // bigint
  return Number(diff) / 1_000_000; // convert to ms using a normal number
}


/* ---------------------------------------------
   Folder detection (anchors + solutions)
--------------------------------------------- */

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
    { key: "sbs-torch", hits: ["torch", "sbs torch"] },
    { key: "coatings", hits: ["coating", "coatings"] },
    { key: "plate", hits: ["plate"] },
  ];

  const variant =
    variants.find((v) => v.hits.some((h) => m.includes(h)))?.key ?? null;

  const solutions = [
    { key: "solutions/hvac", hits: ["hvac", "rtu"] },
    { key: "solutions/satellite-dish", hits: ["satellite", "dish"] },
    { key: "solutions/snow-retention/2pipe", hits: ["2pipe", "two pipe"] },
    { key: "solutions/snow-retention/snow-fence", hits: ["snow fence"] },
    { key: "solutions/roof-guardrail", hits: ["guardrail"] },
    { key: "solutions/roof-ladder", hits: ["roof ladder", "ladder"] },
    { key: "solutions/roof-box", hits: ["roof box"] },
    { key: "solutions/solar", hits: ["solar"] },
    { key: "solutions/lightning", hits: ["lightning"] },
  ];

  const solutionFolder =
    solutions.find((s) => s.hits.some((h) => m.includes(h)))?.key ?? null;

  let anchorFolder: string | null = null;
  if (uSeries && variant) anchorFolder = `anchor/u-anchors/${uSeries}/${variant}`;
  else if (uSeries) anchorFolder = `anchor/u-anchors/${uSeries}`;

  return [anchorFolder, solutionFolder].filter(Boolean).slice(0, 2) as string[];
}

/* ---------------------------------------------
   Fetch docs from /api/docs (server-safe)
--------------------------------------------- */

async function getDocsForFolder(req: Request, folder: string) {
  try {
    const baseUrl = getBaseUrl(req);
    const url = new URL("/api/docs", baseUrl);
    url.searchParams.set("folder", folder);

    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return [];

    const json = await res.json().catch(() => ({}));
    return (json?.files || []) as RecommendedDoc[];
  } catch {
    return [];
  }
}

/* ---------------------------------------------
   Conversation helpers
--------------------------------------------- */

async function ensureConversation(
  supabase: any,
  userId: string,
  conversationId?: string | null
) {
  if (conversationId) {
    const { data, error } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!error && data?.id) return data.id as string;
  }

  const { data: created, error: createErr } = await supabase
    .from("conversations")
    .insert({ user_id: userId, title: "New chat" })
    .select("id")
    .single();

  if (createErr) throw createErr;
  return created.id as string;
}

async function loadRecentHistory(
  supabase: any,
  userId: string,
  conversationId: string,
  limit = 12
): Promise<MsgRow[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("role,content,created_at")
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return ((data || []) as MsgRow[]).reverse();
}

/* ---------------------------------------------
   POST
--------------------------------------------- */

export async function POST(req: Request) {
  const base = new Response(null, { status: 200 });

  try {
    const body = await req.json().catch(() => ({}));
    const message = (body?.message || "").toString().trim();
    const conversationIdFromClient =
      (body?.conversationId || "").toString().trim() || null;

    if (!message) {
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY" },
        { status: 500 }
      );
    }

    const supabase = supabaseRoute(req, base as any);

    // ✅ Auth gate
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr) console.error("API_CHAT_AUTH_ERROR:", authErr);

    const user = authData.user;
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ✅ Profile (self-heal)
    let { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("email,user_type,role")
      .eq("id", user.id)
      .maybeSingle<ProfileRow>();

    if (profileErr) console.error("API_CHAT_PROFILE_SELECT_ERROR:", profileErr);

    if (!profile) {
      const { email, user_type, role } = deriveAccessFromEmail(user.email);
      const { data: created, error: upsertErr } = await supabase
        .from("profiles")
        .upsert(
          {
            id: user.id,
            email,
            user_type,
            role,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" }
        )
        .select("email,user_type,role")
        .single<ProfileRow>();

      if (upsertErr) console.error("API_CHAT_PROFILE_UPSERT_ERROR:", upsertErr);
      profile = created ?? null;
    }

    const userType: UserType =
      profile?.user_type === "external" ? "external" : "internal";

    // ✅ Conversation + history
    const conversationId = await ensureConversation(
      supabase,
      user.id,
      conversationIdFromClient
    );

    const history = await loadRecentHistory(
      supabase,
      user.id,
      conversationId,
      12
    );

    // ✅ Persist user msg (don’t fail whole request if insert fails)
    const { error: userInsertErr } = await supabase.from("messages").insert({
      user_id: user.id,
      conversation_id: conversationId,
      role: "user",
      content: message,
    });
    if (userInsertErr) console.error("MSG_INSERT_USER_ERROR:", userInsertErr);

    // ✅ Docs context + fallback when no folders detected
    const folders = detectFolders(message);

    let recommendedDocs: RecommendedDoc[] = [];
    if (folders.length) {
      const folderDocs = await Promise.all(
        folders.map((folder) => getDocsForFolder(req, folder))
      );
      recommendedDocs = folderDocs.flat().slice(0, 10);
    }

    const noFolderDetected = folders.length === 0;

    const docContext =
      recommendedDocs.length > 0
        ? recommendedDocs
            .map(
              (d) =>
                `- ${d.doc_type}: ${d.title} (${d.path})${
                  d.url ? ` [${d.url}]` : ""
                }`
            )
            .join("\n")
        : "- None (insufficient info to match folders).";
// ✅ Knowledge retrieval (pgvector)
let knowledgeContext = "- None (no approved knowledge matches).";

try {
  const chunks = await retrieveKnowledge(supabase, message, { matchCount: 8 });

  if (chunks.length) {
    knowledgeContext = chunks
      .slice(0, 6) // keep prompt tight
      .map((c, i) => `[#${i + 1} | sim ${Number(c.similarity).toFixed(3)}]\n${c.content}`)
      .join("\n\n");
  }
} catch (e) {
  console.error("KNOWLEDGE_RETRIEVE_ERROR:", e);
}

    // ✅ Prompt (nudges to ask for membrane + series if nothing matched)
    const systemPrompt = `
You are "Anchor Sales Co-Pilot" — an expert Sales Engineer for Anchor Products.

Rules:
- Do NOT fabricate specs, approvals, compatibility, or install steps.
- Ask at most 2 clarifying questions if required.
- Be concise, confident, and sales-ready.
- Follow the response format exactly.
- End with "Recommended documents" using ONLY the provided list.

${
  noFolderDetected
    ? `If the user's message doesn't include enough info to locate docs, you MUST ask for:
- membrane type (EPDM/PVC/TPO/APP/SBS/etc.)
- anchor series if known (example: "U2400")
- what they're mounting (HVAC/pipe supports/snow retention/etc.)
Ask no more than 2 questions.`
    : ""
}

Visibility:
- External users: no competitor comparisons.
- Internal users: competitor comparisons only with provided sources.

Response format:

Recommendation:
- ...

Why:
- ...

Need to confirm:
- ...

Quick questions:
1) ...
2) ...

Recommended documents:
- ...
Approved knowledge context:
${knowledgeContext}

Provided documents:
${docContext}

Provided documents:
${docContext}
`.trim();

    const memoryBlock =
      history.length > 0
        ? history.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n")
        : "";

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_MODEL || "gpt-5-mini";

    // ✅ OpenAI latency + usage logging
    const t0 = process.hrtime.bigint();

    const resp = await client.responses.create({
      model,
      input: [
        { role: "system", content: systemPrompt },
        ...(memoryBlock
          ? [
              {
                role: "user" as const,
                content: `Conversation so far:\n${memoryBlock}`,
              },
            ]
          : []),
        {
          role: "user",
          content: `userType=${userType}\n\nQuestion:\n${message}`,
        },
      ],
    });

    const latencyMs = msSince(t0);

    const usage = (resp as any)?.usage;
    const inputTokens = usage?.input_tokens ?? usage?.inputTokens ?? null;
    const outputTokens = usage?.output_tokens ?? usage?.outputTokens ?? null;
    const totalTokens =
      usage?.total_tokens ??
      usage?.totalTokens ??
      (inputTokens && outputTokens ? inputTokens + outputTokens : null);

    console.log("OPENAI_CHAT_METRICS", {
      conversationId,
      userId: user.id,
      userType,
      model,
      latencyMs,
      inputTokens,
      outputTokens,
      totalTokens,
      foldersDetected: folders,
      recommendedDocsCount: recommendedDocs.length,
    });

    const answer =
      resp.output_text ?? "I couldn’t generate a response. Please try again.";

    // ✅ Persist assistant msg
    const { error: asstInsertErr } = await supabase.from("messages").insert({
      user_id: user.id,
      conversation_id: conversationId,
      role: "assistant",
      content: answer,
    });
    if (asstInsertErr)
      console.error("MSG_INSERT_ASSISTANT_ERROR:", asstInsertErr);

    // ✅ Update conversation title/updated_at
    const title = (message.slice(0, 48) || "New chat").trim();
    const { error: convoUpdateErr } = await supabase
      .from("conversations")
      .update({ title, updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .eq("user_id", user.id);

    if (convoUpdateErr)
      console.error("CONVERSATION_UPDATE_ERROR:", convoUpdateErr);

    const out = NextResponse.json(
      {
        conversationId,
        answer,
        foldersUsed: folders,
        recommendedDocs,
        userType, // optional debug
        metrics: {
          latencyMs,
          inputTokens,
          outputTokens,
          totalTokens,
          noFolderDetected,
        },
      },
      { status: 200 }
    );

    return forwardCookies(base, out);
  } catch (err: any) {
    console.error("CHAT_ROUTE_ERROR:", err);

    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}
