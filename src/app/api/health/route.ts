import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // If this route responds, your Next app/server is up.
  // Later we can also add a Supabase ping check here.
  return NextResponse.json(
    { ok: true, ts: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
