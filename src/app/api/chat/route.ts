// src/app/api/chat/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseRoute } from "@/lib/supabase/server";
import { retrieveKnowledge } from "@/lib/knowledge/retrieve";
import {
  ensureChatSession,
  writeChatMessage,
  maybeSummarizeSession,
  maybeExtractKnowledge,
} from "@/lib/learning/loops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------------------------------------------
   Types
--------------------------------------------- */

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

type SourceUsed = {
  chunkId: string;
  documentId: string;
  title: string | null;
  similarity: number;
  content: string;
};

/* ---------------------------------------------
   Helpers
--------------------------------------------- */

function normalize(s: string) {
  return (s || "").toLowerCase().trim();
}

/** ✅ More reliable than x-forwarded-host in local dev */
function getOrigin(req: Request) {
  return new URL(req.url).origin;
}

/** ✅ Used to decide whether we should try to pull docs immediately */
function isDocumentRequest(message: string) {
  const m = normalize(message);
  return [
    "sheet",
    "sales sheet",
    "datasheet",
    "data sheet",
    "spec sheet",
    "cut sheet",
    "install",
    "installation",
    "install instructions",
    "install guide",
    "instructions",
    "manual",
    "guide",
    "pdf",
    "drawing",
    "details",
    "specs",
    "submittal",
    "sds",
    "msds",
    "cad",
    "dwg",
    "detail",
  ].some((k) => m.includes(k));
}

function tokenizeQuery(message: string) {
  const m = normalize(message)
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // remove junk words so “give me the sheets for light mount” becomes ["light","mount"]
  const stop = new Set([
    "give","me","the","a","an","all","of","for","to","please","need","want",
    "docs","doc","document","documents","file","files","pdf","pdfs",
    "sheet","sheets","sales","spec","specs","cut","data","datasheet",
    "install","installation","instructions","manual","guide"
  ]);

  const tokens = m.split(" ").filter((t) => t.length >= 3 && !stop.has(t));
  return Array.from(new Set(tokens));
}

function filterDocsByMessage(docs: RecommendedDoc[], message: string) {
  const tokens = tokenizeQuery(message);
  if (!tokens.length) return docs;

  return docs.filter((d) => {
    const hay = normalize(`${d.title ?? ""} ${d.doc_type ?? ""} ${d.path ?? ""}`);
    // require at least 1 token match
    return tokens.some((t) => hay.includes(t));
  });
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

function msSince(start: bigint) {
  const diff = process.hrtime.bigint() - start;
  return Number(diff) / 1_000_000;
}

/* ---------------------------------------------
   Document keyword → category query
--------------------------------------------- */

function extractCategoryKeyword(message: string) {
  const m = normalize(message);

  // Keep these “human” phrases because we are doing substring matching.
  const categories = [
    "snow retention",
    "snow fence",
    "2pipe",
    "two pipe",
    "light mount",
    "lighting",
    "hvac",
    "rtu",
    "satellite",
    "dish",
    "guardrail",
    "ladder",
    "solar",
    "lightning",
    "roof box",
  ];

  return categories.find((c) => m.includes(c)) ?? null;
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

  const variant = variants.find((v) => v.hits.some((h) => m.includes(h)))?.key ?? null;

  const solutions = [
    { key: "solutions/hvac", hits: ["hvac", "rtu"] },
    { key: "solutions/satellite-dish", hits: ["satellite", "dish"] },
    { key: "solutions/snow-retention/2pipe", hits: ["2pipe", "two pipe"] },
    { key: "solutions/snow-retention/snow-fence", hits: ["snow fence"] },
    { key: "solutions/roof-guardrail", hits: ["guardrail"] },
    { key: "solutions/roof-ladder", hits: ["ladder", "roof ladder"] },
    { key: "solutions/roof-box", hits: ["roof box"] },
    { key: "solutions/solar", hits: ["solar"] },
    { key: "solutions/lightning", hits: ["lightning"] },
    // ✅ Add your real folder if you have it
    { key: "solutions/light-mount", hits: ["light mount", "lighting"] },
  ];

  const solutionFolder = solutions.find((s) => s.hits.some((h) => m.includes(h)))?.key ?? null;

  let anchorFolder: string | null = null;
  if (uSeries && variant) anchorFolder = `anchor/u-anchors/${uSeries}/${variant}`;
  else if (uSeries) anchorFolder = `anchor/u-anchors/${uSeries}`;

  return [anchorFolder, solutionFolder].filter(Boolean).slice(0, 2) as string[];
}

/* ---------------------------------------------
   Fetch docs from /api/docs (COOKIE FORWARDED)
--------------------------------------------- */

async function fetchDocs(req: Request, url: URL) {
  const cookie = req.headers.get("cookie") ?? "";
  const res = await fetch(url.toString(), {
    cache: "no-store",
    headers: cookie ? { cookie } : {},
  });

  if (!res.ok) return { ok: false, files: [] as RecommendedDoc[] };

  const json = await res.json().catch(() => ({}));
  return { ok: true, files: (json?.files || []) as RecommendedDoc[] };
}

async function getDocsForFolder(req: Request, folder: string) {
  try {
    const url = new URL("/api/docs", getOrigin(req));
    url.searchParams.set("folder", folder);

    const { files } = await fetchDocs(req, url);
    return files;
  } catch {
    return [];
  }
}

async function getDocsGlobal(req: Request) {
  try {
    const url = new URL("/api/docs", getOrigin(req));
    const { files } = await fetchDocs(req, url);
    return files;
  } catch {
    return [];
  }
}

async function getDocsByCategory(req: Request, category: string) {
  try {
    const url = new URL("/api/docs", getOrigin(req));
    url.searchParams.set("q", category); // substring match implemented by /api/docs

    const { files } = await fetchDocs(req, url);
    return files;
  } catch {
    return [];
  }
}

/* ---------------------------------------------
   Conversations (legacy)
--------------------------------------------- */

async function ensureConversation(supabase: any, userId: string, conversationId?: string | null) {
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
    const conversationIdFromClient = (body?.conversationId || "").toString().trim() || null;
    const sessionIdFromClient = (body?.sessionId || "").toString().trim() || null;
    const forceLearn = Boolean(body?.forceLearn);

    if (!message) return NextResponse.json({ error: "Missing message" }, { status: 400 });
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    const wantsDocument = isDocumentRequest(message);

    const supabase = supabaseRoute(req, base as any);

    // ✅ Auth gate
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr) console.error("API_CHAT_AUTH_ERROR:", authErr);
    const user = authData.user;
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // ✅ Profile self-heal
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
          { id: user.id, email, user_type, role, updated_at: new Date().toISOString() },
          { onConflict: "id" }
        )
        .select("email,user_type,role")
        .single<ProfileRow>();

      if (upsertErr) console.error("API_CHAT_PROFILE_UPSERT_ERROR:", upsertErr);
      profile = created ?? null;
    }

    const userType: UserType = profile?.user_type === "external" ? "external" : "internal";

    // ✅ Legacy conversation + recent history
    const conversationId = await ensureConversation(supabase, user.id, conversationIdFromClient);
    const history = await loadRecentHistory(supabase, user.id, conversationId, 12);

    // ✅ learning continuity (new tables)
    const sessionId = await ensureChatSession(supabase, user.id, sessionIdFromClient);

    // write user message to both systems
    await writeChatMessage(supabase, user.id, sessionId, "user", message);
    const { error: userInsertErr } = await supabase.from("messages").insert({
      user_id: user.id,
      conversation_id: conversationId,
      role: "user",
      content: message,
    });
    if (userInsertErr) console.error("MSG_INSERT_USER_ERROR:", userInsertErr);

    // ---------------- DOC RETRIEVAL (ALWAYS COOKIE-FORWARDED) ----------------
    
const folders = detectFolders(message);
const category = extractCategoryKeyword(message);

let recommendedDocs: RecommendedDoc[] = [];

if (wantsDocument) {
  // 1) folder-based
  if (folders.length) {
    const folderDocs = await Promise.all(folders.map((f) => getDocsForFolder(req, f)));
    recommendedDocs = folderDocs.flat();
  }

  // 2) category keyword search across storage (q=)
  if (!recommendedDocs.length && category) {
    recommendedDocs = await getDocsByCategory(req, category);
  }

  // 3) global fallback (entire bucket)
  // IMPORTANT: even if you found folder docs, we still want global + filter so “light mount”
  // works even if it’s not under the folder you think.
  const globalDocs = await getDocsGlobal(req);

  // merge unique by path
  const byPath = new Map<string, RecommendedDoc>();
  for (const d of [...recommendedDocs, ...globalDocs]) byPath.set(d.path, d);
  const merged = Array.from(byPath.values());

  const filtered = filterDocsByMessage(merged, message);
  recommendedDocs = (filtered.length ? filtered : merged).slice(0, 12);

  console.log("DOCS_DEBUG", {
    message,
    wantsDocument,
    folders,
    category,
    mergedCount: merged.length,
    filteredCount: filtered.length,
    returned: recommendedDocs.slice(0, 5).map((d) => d.path),
  });
} else {
  // non-document queries: still provide relevant docs if folders detected
  if (folders.length) {
    const folderDocs = await Promise.all(folders.map((f) => getDocsForFolder(req, f)));
    recommendedDocs = folderDocs.flat().slice(0, 10);
  }
}

// ✅ SHORT-CIRCUIT: document request -> return files immediately (no OpenAI)
if (wantsDocument) {
  const answer =
    recommendedDocs.length > 0
      ? "Here are the sheets/files."
      : "I couldn’t find matching files in Storage for that request.";

  // write assistant message to both systems
  await writeChatMessage(supabase, user.id, sessionId, "assistant", answer);
  await supabase.from("messages").insert({
    user_id: user.id,
    conversation_id: conversationId,
    role: "assistant",
    content: answer,
  });

  // update legacy conversation title
  const title = (message.slice(0, 48) || "New chat").trim();
  await supabase
    .from("conversations")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("user_id", user.id);

  const out = NextResponse.json(
    {
      conversationId,
      sessionId,
      answer,
      foldersUsed: folders,
      recommendedDocs,
      sourcesUsed: [],
      userType,
      metrics: {
        latencyMs: 0,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        noFolderDetected: false,
      },
    },
    { status: 200 }
  );

  return forwardCookies(base, out);
}


    console.log("DOCS_DEBUG", {
      message,
      wantsDocument,
      folders,
      category,
      recommendedDocsCount: recommendedDocs.length,
      sample: recommendedDocs.slice(0, 2).map((d) => d.path),
    });

    // ✅ SHORT-CIRCUIT: if user asked for a doc and we found docs, return now.
    if (wantsDocument && recommendedDocs.length > 0) {
      const answer =
        recommendedDocs.length === 1
          ? "Here it is."
          : "Here are the files.";

      // write assistant message to both systems
      await writeChatMessage(supabase, user.id, sessionId, "assistant", answer);
      const { error: asstInsertErr } = await supabase.from("messages").insert({
        user_id: user.id,
        conversation_id: conversationId,
        role: "assistant",
        content: answer,
      });
      if (asstInsertErr) console.error("MSG_INSERT_ASSISTANT_ERROR:", asstInsertErr);

      // update legacy conversation title
      const title = (message.slice(0, 48) || "New chat").trim();
      const { error: convoUpdateErr } = await supabase
        .from("conversations")
        .update({ title, updated_at: new Date().toISOString() })
        .eq("id", conversationId)
        .eq("user_id", user.id);
      if (convoUpdateErr) console.error("CONVERSATION_UPDATE_ERROR:", convoUpdateErr);

      const out = NextResponse.json(
        {
          conversationId,
          sessionId,
          answer,
          foldersUsed: folders,
          recommendedDocs,
          sourcesUsed: [],
          userType,
          metrics: {
            latencyMs: 0,
            inputTokens: null,
            outputTokens: null,
            totalTokens: null,
            noFolderDetected: false,
          },
        },
        { status: 200 }
      );

      return forwardCookies(base, out);
    }

    // ---------------- KNOWLEDGE RETRIEVAL ----------------
    let knowledgeContext = "- None (no approved knowledge matches).";
    let sourcesUsed: SourceUsed[] = [];

    try {
      const chunks = await retrieveKnowledge(supabase, message, { matchCount: 8 });

      if (chunks?.length) {
        knowledgeContext = chunks
          .slice(0, 6)
          .map(
            (c: any, i: number) =>
              `[#${i + 1} | sim ${Number(c.similarity ?? 0).toFixed(3)}]\n${String(
                c.content || ""
              )}`
          )
          .join("\n\n");

        sourcesUsed = chunks.slice(0, 6).map((c: any) => ({
          chunkId: String(c.id || c.chunk_id || c.chunkId || ""),
          documentId: String(c.document_id || c.documentId || ""),
          title: null,
          similarity: Number(c.similarity ?? 0),
          content: String(c.content || ""),
        }));
      }
    } catch (e) {
      console.error("KNOWLEDGE_RETRIEVE_ERROR:", e);
    }

    // ---------------- PROMPT ----------------
    const noFolderDetected = folders.length === 0 && !wantsDocument;

    const docContext =
      recommendedDocs.length > 0
        ? recommendedDocs.map((d) => `- ${d.doc_type}: ${d.title} (${d.path})`).join("\n")
        : "- None.";

    const systemPrompt = `
You are "Anchor Sales Co-Pilot" — an expert Sales Engineer for Anchor Products.

Rules:
- Do NOT fabricate specs, approvals, compatibility, or install steps.
- Ask at most 2 clarifying questions if required.
- Be concise, confident, and sales-ready.
- End with "Recommended documents" using ONLY the provided list below.

${
  noFolderDetected
    ? `If the user's message doesn't include enough info to locate docs, ask for at most 2:
1) membrane type (EPDM/PVC/TPO/APP/SBS/etc.)
2) what they're mounting (HVAC/snow retention/satellite/solar/etc.)`
    : ""
}

Approved knowledge context:
${knowledgeContext}

Provided documents:
${docContext}

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
`.trim();

    const memoryBlock =
      history.length > 0
        ? history.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n")
        : "";

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_MODEL || "gpt-5-mini";

    const t0 = process.hrtime.bigint();

    const resp = await client.responses.create({
      model,
      input: [
        { role: "system", content: systemPrompt },
        ...(memoryBlock
          ? [{ role: "user" as const, content: `Conversation so far:\n${memoryBlock}` }]
          : []),
        { role: "user", content: `userType=${userType}\n\nQuestion:\n${message}` },
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

    const answer = resp.output_text ?? "I couldn’t generate a response. Please try again.";

    // write assistant message to both systems
    const { error: asstInsertErr } = await supabase.from("messages").insert({
      user_id: user.id,
      conversation_id: conversationId,
      role: "assistant",
      content: answer,
    });
    if (asstInsertErr) console.error("MSG_INSERT_ASSISTANT_ERROR:", asstInsertErr);

    await writeChatMessage(supabase, user.id, sessionId, "assistant", answer);

    // learning loops
    if (forceLearn) {
      await maybeSummarizeSession(supabase, user.id, sessionId);
      await maybeExtractKnowledge(supabase, user.id, sessionId);
    } else {
      await maybeSummarizeSession(supabase, user.id, sessionId);
      await maybeExtractKnowledge(supabase, user.id, sessionId);
    }

    // update legacy conversation title
    const title = (message.slice(0, 48) || "New chat").trim();
    const { error: convoUpdateErr } = await supabase
      .from("conversations")
      .update({ title, updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .eq("user_id", user.id);
    if (convoUpdateErr) console.error("CONVERSATION_UPDATE_ERROR:", convoUpdateErr);

    const out = NextResponse.json(
      {
        conversationId,
        sessionId,
        answer,
        foldersUsed: folders,
        recommendedDocs,
        sourcesUsed,
        userType,
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
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
