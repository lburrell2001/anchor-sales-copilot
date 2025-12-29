"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

function isEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export default function LoginHome() {
  return (
    <Suspense
      fallback={
        <main className="min-h-dvh bg-neutral-950 text-white">
          <div className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-10 pt-10">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="text-sm text-white/70">Loading…</div>
            </div>
          </div>
        </main>
      }
    >
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const nextUrl = useMemo(() => sp.get("next") || "/chat", [sp]);

  const supabase = useMemo(() => supabaseBrowser(), []);

  const [email, setEmail] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // If already authed, go to chat
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      if (data.session) router.replace("/chat");
    })();
    return () => {
      alive = false;
    };
  }, [supabase, router]);

  // Show auth errors from URL hash
  useEffect(() => {
    const hash = window.location.hash || "";
    if (!hash) return;

    const params = new URLSearchParams(hash.replace(/^#/, ""));
    const desc = params.get("error_description");
    if (desc) setMsg(desc.replace(/\+/g, " "));

    window.history.replaceState({}, "", window.location.pathname + window.location.search);
  }, []);

  function reset() {
    setOtpSent(false);
    setOtp("");
  }

  async function sendCode() {
    setMsg(null);

    const e = email.trim().toLowerCase();
    if (!isEmail(e)) return setMsg("Enter a valid email.");

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: e,
        options: {
          shouldCreateUser: true,
          emailRedirectTo:
            typeof window !== "undefined"
              ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextUrl)}`
              : undefined,
        },
      });

      if (error) throw error;

      setOtpSent(true);
      setMsg("Enter the 8-digit code from your email.");
    } catch (err: any) {
      setMsg(err?.message || "Couldn’t send code. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode() {
    setMsg(null);

    const e = email.trim().toLowerCase();
    const code = otp.trim();

    if (!isEmail(e)) return setMsg("Enter a valid email.");
    if (code.length < 6) return setMsg("Enter the 6-digit code.");

    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: e,
        token: code,
        type: "email",
      });

      if (error) throw error;

      router.replace(nextUrl);
      router.refresh();
    } catch (err: any) {
      setMsg(err?.message || "Invalid code. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-dvh bg-neutral-950 text-white">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-10 pt-10">
        <div className="mb-8">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl border border-white/10 bg-black/40 flex items-center justify-center">
              <img src="/anchorp.svg" alt="Anchor" className="h-8 w-auto" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-wide">Anchor Sales Co-Pilot</div>
              <div className="text-[12px] text-white/60">Docs • Specs • Install • Downloads</div>
            </div>
          </div>

          <h1 className="mt-6 text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-2 text-sm text-white/60">
            We’ll email you a secure 8-digit code. Fast, simple, mobile-ready.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur shadow-[0_0_0_1px_rgba(255,255,255,0.06)]">
          <label className="block text-xs font-semibold text-white/70">Email</label>
          <input
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (otpSent) reset();
            }}
            inputMode="email"
            autoComplete="email"
            placeholder="name@company.com"
            className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-base outline-none placeholder:text-white/35 focus:border-emerald-300/30"
          />

          {!otpSent ? (
            <div className="mt-3 flex items-center justify-between">
              <div className="text-xs text-white/60">We’ll send a 8-digit code.</div>
              <Link
                href="/signup"
                className="text-xs text-emerald-200 hover:text-emerald-100 underline-offset-4 hover:underline"
              >
                First time user
              </Link>
            </div>
          ) : (
            <>
              <label className="mt-4 block text-xs font-semibold text-white/70">8-digit code</label>
              <input
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="12345678"
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-base outline-none placeholder:text-white/35 focus:border-emerald-300/30"
                onKeyDown={(e) => {
                  if (e.key === "Enter") verifyCode();
                }}
              />

              <div className="mt-3 flex items-center justify-between">
                <button
                  type="button"
                  onClick={sendCode}
                  disabled={loading}
                  className="text-xs text-white/70 hover:text-white underline-offset-4 hover:underline disabled:opacity-60"
                >
                  Resend code
                </button>

                <button
                  type="button"
                  onClick={() => {
                    reset();
                    setMsg(null);
                  }}
                  className="text-xs text-emerald-200 hover:text-emerald-100 underline-offset-4 hover:underline"
                >
                  Change email
                </button>
              </div>
            </>
          )}

          {msg && (
            <div className="mt-4 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/85">
              {msg}
            </div>
          )}

          {!otpSent ? (
            <button
              type="button"
              onClick={sendCode}
              disabled={loading}
              className="mt-5 w-full rounded-xl bg-gradient-to-r from-emerald-400 to-lime-400 px-4 py-3 text-base font-semibold text-black shadow disabled:opacity-60"
            >
              {loading ? "Sending…" : "Send code"}
            </button>
          ) : (
            <button
              type="button"
              onClick={verifyCode}
              disabled={loading}
              className="mt-5 w-full rounded-xl bg-gradient-to-r from-emerald-400 to-lime-400 px-4 py-3 text-base font-semibold text-black shadow disabled:opacity-60"
            >
              {loading ? "Verifying…" : "Verify code"}
            </button>
          )}
        </div>

        <p className="mt-6 text-center text-[11px] text-white/40">
          If you don’t have access, ask an admin to enable your account.
        </p>
      </div>
    </main>
  );
}
