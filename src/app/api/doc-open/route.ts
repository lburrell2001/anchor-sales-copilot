// src/app/api/doc-open/route.ts
import { NextResponse } from "next/server";
import { supabaseRoute } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "knowledge";
const EXPIRES_IN_SECONDS = 60 * 10; // 10 minutes

export async function GET(req: Request) {
  try {
    // Auth check (must be signed in)
    const base = NextResponse.next();
    const supabase = supabaseRoute(req, base);

    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const path = String(url.searchParams.get("path") || "").trim();
    if (!path) return NextResponse.json({ error: "Missing path" }, { status: 400 });

    // Create a fresh signed URL using service role
    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(path, EXPIRES_IN_SECONDS);

    if (error || !data?.signedUrl) {
      return NextResponse.json({ error: error?.message || "Could not sign URL" }, { status: 500 });
    }

    return NextResponse.json({ url: data.signedUrl }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
