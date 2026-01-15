// src/app/api/auth/sync/route.ts
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isHttps(req: Request) {
  // Vercel / reverse proxies send this
  const xfProto = req.headers.get("x-forwarded-proto");
  if (xfProto) return xfProto.includes("https");
  // Local dev / direct
  return req.url.startsWith("https://");
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const access_token = String(body?.access_token || "");
    const refresh_token = String(body?.refresh_token || "");

    if (!access_token || !refresh_token) {
      return NextResponse.json({ ok: false, error: "Missing tokens" }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    if (!url || !anon) {
      return NextResponse.json(
        { ok: false, error: "Missing NEXT_PUBLIC_SUPABASE_URL/ANON_KEY" },
        { status: 500 }
      );
    }

    const toSet: Array<{ name: string; value: string; options?: any }> = [];

    const supabase = createServerClient(url, anon, {
      cookies: {
        getAll() {
          return [];
        },
        setAll(cookiesToSet) {
          toSet.push(...cookiesToSet);
        },
      },
    });

    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 401 });
    }

    const res = NextResponse.json(
      { ok: true, set: toSet.map((c) => c.name) },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );

    const secure = isHttps(req);

    for (const c of toSet) {
      // Normalize options so localhost HTTP can store cookies
      const opts = {
        ...(c.options || {}),
        secure,          // ✅ critical fix
        sameSite: c.options?.sameSite ?? "lax",
        path: c.options?.path ?? "/",
      };

      // Avoid setting Domain on localhost (can break storage)
      if (opts.domain === "localhost") delete opts.domain;

      res.cookies.set(c.name, c.value, opts);
    }

    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}
