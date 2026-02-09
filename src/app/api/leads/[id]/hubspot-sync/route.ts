import { NextRequest, NextResponse } from "next/server";
import { supabaseRoute } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isInternalRole(role: string) {
  return role === "admin" || role === "anchor_rep";
}

async function getRole(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return String((data as any)?.role || "");
}

function clean(v: any) {
  return String(v || "").trim();
}

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const supabase = await supabaseRoute();
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const role = await getRole(auth.user.id);
    if (!isInternalRole(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const id = clean(ctx.params.id);
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ error: "Missing Supabase service configuration." }, { status: 500 });
    }

    const res = await fetch(`${supabaseUrl}/functions/v1/hubspot-lead-sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ lead_id: id }),
    });

    const text = await res.text();
    const json = text ? JSON.parse(text) : {};

    if (!res.ok) {
      return NextResponse.json({ error: json?.error || "HubSpot sync failed." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, result: json });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to sync lead." }, { status: 500 });
  }
}
