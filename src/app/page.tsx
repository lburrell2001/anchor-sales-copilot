"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

export const dynamic = "force-dynamic";

function isEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export default function LoginHome() {
  return (
    <Suspense fallback={<FullScreenLoading />}>
      <LoginInner />
    </Suspense>
  );
}

function FullScreenLoading() {
  return (
    <main className="min-h-dvh bg-[#047835] text-white flex items-center justify-center">
      <div className="rounded-3xl bg-white/10 px-6 py-4 text-sm">
        Loading…
      </div>
    </main>
  );
}

function LoginInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const nextUrl = useMemo(() => sp.get("next") || "/dashboard", [sp]);
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [email, setEmail] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Already signed in → dashboard
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) router.replace("/dashboard");
    })();
  }, [supabase, router]);

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
      setMsg("Enter the code from your email.");
    } catch (err: any) {
      setMsg(err?.message || "Couldn’t send code.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode() {
    setMsg(null);
    if (otp.trim().length < 6) return setMsg("Enter the code from your email.");

    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: otp.trim(),
        type: "email",
      });

      if (error) throw error;
      router.replace(nextUrl);
      router.refresh();
    } catch (err: any) {
      setMsg(err?.message || "Invalid code.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-dvh bg-[#F6F7F8] text-white flex items-center justify-center px-5 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="mb-8 flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-white/10 ring-1 ring-white/20 flex items-center justify-center">
            <img src="/anchorp.svg" alt="Anchor" className="h-10 w-auto" />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-wide text-black/80">
              Anchor Sales Co-Pilot
            </div>
            <div className="text-[12px] text-black/80">
              Docs • Specs • Install • Downloads
            </div>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-3xl bg-[#047835]/95 text-White p-6 shadow-xl">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-white">
            We’ll email you a secure login code.
          </p>

          <label className="mt-5 block text-xs font-semibold text-white/70">
            Email
          </label>
          <input
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (otpSent) reset();
            }}
            placeholder="name@company.com"
            className="mt-2 w-full rounded-2xl border-white/20 px-4 py-3 outline-none focus:border-[#047835]"
          />

          {otpSent && (
            <>
              <label className="mt-4 block text-xs font-semibold text-white/70">
                Code
              </label>
              <input
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="123456"
                inputMode="numeric"
                className="mt-2 w-full rounded-2xl border-white/20 px-4 py-3 outline-none focus:border-[#047835]"
                onKeyDown={(e) => e.key === "Enter" && verifyCode()}
              />
            </>
          )}

          {msg && (
            <div className="mt-4 rounded-xl bg-[#F6F7F8] px-4 py-3 text-sm text-black/80">
              {msg}
            </div>
          )}

          {!otpSent ? (
            <button
              onClick={sendCode}
              disabled={loading}
              className="mt-6 w-full rounded-2xl bg-[#F6F7F8] py-3 text-sm font-semibold text-[#11500F] hover:bg-[#9CE2BB]"
            >
              {loading ? "Sending…" : "Send code"}
            </button>
          ) : (
            <button
              onClick={verifyCode}
              disabled={loading}
              className="mt-6 w-full rounded-2xl bg-[#F6F7F8] py-3 text-sm font-semibold text-[#11500F] hover:bg-[#9CE2BB]"
            >
              {loading ? "Verifying…" : "Verify code"}
            </button>
          )}
        </div>

        <p className="mt-6 text-center text-[11px] text-black
      /80">
          If you don’t have access, ask an admin to enable your account.
        </p>
      </div>
    </main>
  );
}
