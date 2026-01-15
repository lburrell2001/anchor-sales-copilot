import { NextResponse } from "next/server";
import { supabaseRoute } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function isInternalRole(role: string) {
  return role === "admin" || role === "anchor_rep";
}

export async function POST(req: Request) {
  try {
    const supabase = await supabaseRoute();
    const { data: auth } = await supabase.auth.getUser();
    const user = auth.user;
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const productId = String(body?.productId || "").trim();
    const c = body?.contact || {};

    const full_name = String(c?.full_name || "").trim();
    if (!productId) return NextResponse.json({ error: "Missing productId" }, { status: 400 });
    if (!full_name) return NextResponse.json({ error: "Full name is required" }, { status: 400 });

    // role check
    const { data: prof, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
    if (!isInternalRole(String(prof?.role || ""))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // 1) create contact
    const { data: newContact, error: insErr } = await supabaseAdmin
      .from("internal_contacts")
      .insert({
        full_name,
        company: c.company ?? null,
        email: c.email ?? null,
        phone: c.phone ?? null,
        territory: c.territory ?? null,
        notes: c.notes ?? null,
        active: c.active !== false,
      })
      .select("id")
      .single();

    if (insErr || !newContact?.id) {
      return NextResponse.json({ error: insErr?.message || "Failed to add contact" }, { status: 500 });
    }

    // 2) link membership
    const { error: memErr } = await supabaseAdmin.from("internal_contact_memberships").insert({
      product_id: productId,
      contact_id: newContact.id,
    });

    if (memErr) {
      return NextResponse.json({ error: memErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, contactId: newContact.id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
