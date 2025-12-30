// src/app/api/chat/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseRoute } from "@/lib/supabase/server";

export const runtime = "nodejs";

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

/* ---------------------------------------------
   Folder detection (anchors + solutions)
--------------------------------------------- */

function detectFolders(message: string) {
  const m = normalize(message);

  // Detect anchor series (u2400, u2600, etc.)
  const uMatch = m.match(/\bu(\d{4})\b/);
  const uSeries = uMatch ? `u${uMatch[1]}` : null;

  // Membrane / variant detection
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

  // Solution detection
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

  // Anchor folder
  let anchorFolder: string | null = null;
  if (uSeries && variant) {
    anchorFolder = `anchor/u-anchors/${uSeries}/${variant}`;
  } else if (uSeries) {
    anchorFolder = `anchor/u-anchors/${uSeries}`;
  }

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
  // If client provided a conversationId, verify it belongs to this user
  if (conversationId) {
    const { data, error } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!error && data?.id) return data.id as string;
  }

  // Otherwise create a new one
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
  // ✅ Create a response object so Supabase can attach cookie/header changes if needed
  const res = NextResponse.next();

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

    const supabase = supabaseRoute(req, res);

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

    const history = await loadRecentHistory(supabase, user.id, conversationId, 12);

    // ✅ Persist user message (don’t fail the whole request if insert fails)
    const { error: userInsertErr } = await supabase.from("messages").insert({
      user_id: user.id,
      conversation_id: conversationId,
      role: "user",
      content: message,
    });
    if (userInsertErr) console.error("MSG_INSERT_USER_ERROR:", userInsertErr);

    // ✅ Docs context
    const folders = detectFolders(message);
    const folderDocs = await Promise.all(
      folders.map((folder) => getDocsForFolder(req, folder))
    );
    const recommendedDocs = folderDocs.flat().slice(0, 10);

    const docContext =
      recommendedDocs.length > 0
        ? recommendedDocs
            .map(
              (d) =>
                `- ${d.doc_type}: ${d.title} (${d.path})${d.url ? ` [${d.url}]` : ""}`
            )
            .join("\n")
        : "- None matched yet.";

    // ✅ Prompt
    const systemPrompt = `
You are "Anchor Sales Co-Pilot" — an expert Sales Engineer for Anchor Products.

Rules:
- Do NOT fabricate specs, approvals, compatibility, or install steps.
- Ask at most 2 clarifying questions if required.
- Be concise, confident, and sales-ready.
- Follow the response format exactly.
- End with "Recommended documents" using ONLY the provided list.

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

Provided documents:
${docContext}
`.trim();

    // ✅ Build model input with short memory
    const memoryBlock =
      history.length > 0
        ? history.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n")
        : "";

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_MODEL || "gpt-5-mini";

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

    const answer =
      resp.output_text ?? "I couldn’t generate a response. Please try again.";

    // ✅ Persist assistant message
    const { error: asstInsertErr } = await supabase.from("messages").insert({
      user_id: user.id,
      conversation_id: conversationId,
      role: "assistant",
      content: answer,
    });
    if (asstInsertErr) console.error("MSG_INSERT_ASSISTANT_ERROR:", asstInsertErr);

    // ✅ Update conversation title/updated_at
    const title = (message.slice(0, 48) || "New chat").trim();
    const { error: convoUpdateErr } = await supabase
      .from("conversations")
      .update({ title, updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .eq("user_id", user.id);

    if (convoUpdateErr) console.error("CONVERSATION_UPDATE_ERROR:", convoUpdateErr);

    // ✅ Return JSON + preserve any headers/cookies from Supabase
    return NextResponse.json(
      {
        conversationId,
        answer,
        foldersUsed: folders,
        recommendedDocs,
        userType, // optional debug
      },
      { headers: res.headers }
    );
  } catch (err: any) {
    console.error("CHAT_ROUTE_ERROR:", err);
    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}
