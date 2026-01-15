// src/lib/supabase/server.ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieKV = { name: string; value: string };

// Supabase cookie names vary slightly by project ref.
// We'll just return ANY cookies whose name starts with "sb-"
function readSupabaseCookies(cookieStore: any): CookieKV[] {
  // If getAll exists, use it (best)
  if (typeof cookieStore.getAll === "function") {
    const all = cookieStore.getAll();
    return (all || [])
      .filter((c: any) => typeof c?.name === "string" && c.name.startsWith("sb-"))
      .map((c: any) => ({ name: c.name, value: String(c.value ?? "") }));
  }

  // If getAll doesn't exist, we can't enumerate.
  // BUT: @supabase/ssr really only needs the auth cookies.
  // In most setups, the cookie names include your project ref, so enumeration is ideal.
  //
  // Workaround: attempt common cookie keys. (If none exist, returns empty and auth will be null.)
  const common = [
    "sb-access-token",
    "sb-refresh-token",
  ];

  const out: CookieKV[] = [];
  for (const name of common) {
    try {
      const v = cookieStore.get?.(name)?.value;
      if (v) out.push({ name, value: v });
    } catch {}
  }
  return out;
}

export async function supabaseRoute() {
  // Next 16: cookies() is async in your runtime
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing env vars: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        // Only return Supabase cookies (prevents weird size issues)
        return readSupabaseCookies(cookieStore);
      },
      setAll(cookiesToSet) {
        try {
          for (const c of cookiesToSet) {
            // safest: object form with options spread
            cookieStore.set({
              name: c.name,
              value: c.value,
              ...(c.options || {}),
            });
          }
        } catch {
          // Some paths can't set cookies; reads still work.
        }
      },
    },
  });
}
