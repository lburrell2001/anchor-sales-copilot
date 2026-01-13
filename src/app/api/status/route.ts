import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Lightweight DB ping
    const { error } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .limit(1);

    if (error) {
      return NextResponse.json(
        { ok: false, status: "Degraded", detail: error.message },
        { status: 200 }
      );
    }

    return NextResponse.json({ ok: true, status: "Online" }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, status: "Offline", detail: e?.message || "Unknown error" },
      { status: 200 }
    );
  }
}
