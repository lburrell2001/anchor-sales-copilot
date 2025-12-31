/// <reference lib="deno.ns" />
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { Resend } from "https://esm.sh/resend@4";

function getAdminList(): string[] {
  const raw = Deno.env.get("ADMIN_ALERT_EMAILS") ?? "";
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

function fmt(iso: string) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

Deno.serve(async (_req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
  const SITE_URL = Deno.env.get("SITE_URL") ?? "";

  const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

function unauthorized(msg = "Unauthorized") {
  return new Response(msg, { status: 401 });
}

Deno.serve(async (req) => {
  // Allow manual "Test" in dashboard if you want:
  // but for cron, require the header
  const provided = req.headers.get("x-cron-secret") ?? "";
  if (CRON_SECRET && provided !== CRON_SECRET) {
    return unauthorized("Bad cron secret");
  }

  // ...rest of your existing function...
});

  const to = getAdminList();
  if (!to.length) return new Response("No ADMIN_ALERT_EMAILS configured", { status: 200 });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const now = new Date().toISOString();

  // Pull all undigested events from last 24h (or all undigested if you prefer)
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: events, error } = await supabase
    .from("training_events")
    .select("id,kind,ref_id,actor_user_id,rating,status,conversation_id,session_id,document_id,chunk_id,note,correction,created_at,digested_at")
    .is("digested_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) return new Response(`DB error: ${error.message}`, { status: 500 });

  if (!events || events.length === 0) {
    return new Response("No new training events", { status: 200 });
  }

  const corrections = events.filter(e => e.kind === "correction");
  const badFeedback = events.filter(e => e.kind === "feedback" && (e.rating ?? 0) <= 2);

  const subject = `Anchor Co-Pilot digest: ${corrections.length} corrections, ${badFeedback.length} low ratings`;

  const lines: string[] = [];
  lines.push(`Daily training digest (${fmt(now)})`);
  lines.push(``);
  lines.push(`New corrections: ${corrections.length}`);
  lines.push(`Low ratings (<=2): ${badFeedback.length}`);
  lines.push(`Total events: ${events.length}`);
  lines.push(``);

  const dash = SITE_URL ? `${SITE_URL}/admin/knowledge` : "/admin/knowledge";
  lines.push(`Open dashboard: ${dash}`);
  lines.push(``);

  if (corrections.length) {
    lines.push(`--- Corrections (latest) ---`);
    for (const c of corrections.slice(0, 10)) {
      lines.push(
        `• ${fmt(c.created_at)} | status=${c.status ?? "—"} | doc=${c.document_id ?? "—"} | chunk=${c.chunk_id ?? "—"}`
      );
      if (c.note) lines.push(`  note: ${c.note}`);
      if (c.correction) lines.push(`  correction: ${String(c.correction).slice(0, 240)}`);
    }
    lines.push(``);
  }

  if (badFeedback.length) {
    lines.push(`--- Low ratings (latest) ---`);
    for (const f of badFeedback.slice(0, 10)) {
      lines.push(
        `• ${fmt(f.created_at)} | rating=${f.rating ?? "—"} | doc=${f.document_id ?? "—"} | chunk=${f.chunk_id ?? "—"}`
      );
      if (f.note) lines.push(`  note: ${f.note}`);
    }
    lines.push(``);
  }

  const bodyText = lines.join("\n");

  // Send email (Resend)
  if (!RESEND_API_KEY) return new Response("Missing RESEND_API_KEY", { status: 500 });

  const resend = new Resend(RESEND_API_KEY);
  await resend.emails.send({
    from: "Anchor Co-Pilot <onboarding@resend.dev>", // must be a verified sender in Resend
    to,
    subject,
    text: bodyText,
  });

  // Mark events as digested
  const ids = events.map((e) => e.id);
  const { error: upErr } = await supabase
    .from("training_events")
    .update({ digested_at: now })
    .in("id", ids);

  if (upErr) return new Response(`Digest sent, but failed to mark digested: ${upErr.message}`, { status: 500 });

  return new Response(`Digest sent. Marked ${ids.length} events.`, { status: 200 });
});
