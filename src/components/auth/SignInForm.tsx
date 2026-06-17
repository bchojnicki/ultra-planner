import React, { useEffect, useState } from "react";
import { Mail, KeyRound, LogIn, Send } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";

// Cooldown (seconds) before the "Resend code" control re-enables. Discourages
// rapid re-requests that would hit Supabase's send rate limit.
const RESEND_COOLDOWN_SECONDS = 30;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Props {
  // Driven by signin.astro from the URL: "email" (request a code) or "verify" (enter it).
  step?: "email" | "verify";
  email?: string;
  serverError?: string | null;
}

// Passwordless sign-in (email-otp-auth / S-06). Two states on one page:
//   email  → POST /api/auth/request-code → server redirects to ?step=verify&email=…
//   verify → POST /api/auth/verify-code  → server sets the session cookie, redirects to /
// Sign-up and sign-in are the same flow (the server creates the user on first code).
export default function SignInForm({ step = "email", email: initialEmail = "", serverError }: Props) {
  const [email, setEmail] = useState(initialEmail);
  const [token, setToken] = useState("");
  const [errors, setErrors] = useState<{ email?: string; token?: string }>({});

  // On the verify step a code was just sent, so start the resend cooldown.
  const [cooldown, setCooldown] = useState(step === "verify" ? RESEND_COOLDOWN_SECONDS : 0);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => {
      setCooldown((c) => c - 1);
    }, 1000);
    return () => {
      clearTimeout(t);
    };
  }, [cooldown]);

  function handleEmailSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!email.trim()) {
      setErrors({ email: "Email is required" });
      e.preventDefault();
    } else if (!EMAIL_RE.test(email)) {
      setErrors({ email: "Enter a valid email address" });
      e.preventDefault();
    }
  }

  function handleVerifySubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!/^\d{6}$/.test(token.trim())) {
      setErrors({ token: "Enter the 6-digit code from your email" });
      e.preventDefault();
    }
  }

  if (step === "verify") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-blue-100/70">
          We sent a 6-digit code to <span className="font-medium text-blue-100">{initialEmail}</span>. It expires in 1
          hour.
        </p>

        <form
          method="POST"
          action="/api/auth/verify-code"
          className="space-y-4"
          onSubmit={handleVerifySubmit}
          noValidate
        >
          <input type="hidden" name="email" value={initialEmail} />
          <FormField
            id="token"
            name="token"
            label="6-digit code"
            type="text"
            value={token}
            onChange={(v) => {
              setToken(v);
              if (errors.token) setErrors({});
            }}
            placeholder="123456"
            error={errors.token}
            icon={<KeyRound className="size-4" />}
          />
          <ServerError message={serverError} />
          <SubmitButton pendingText="Verifying..." icon={<LogIn className="size-4" />}>
            Verify &amp; sign in
          </SubmitButton>
        </form>

        <div className="flex items-center justify-between text-sm">
          <form method="POST" action="/api/auth/request-code">
            <input type="hidden" name="email" value={initialEmail} />
            <button
              type="submit"
              disabled={cooldown > 0}
              className="text-purple-300 hover:underline disabled:cursor-not-allowed disabled:text-blue-100/40 disabled:no-underline"
            >
              {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
            </button>
          </form>
          <a href="/auth/signin" className="text-blue-100/60 hover:underline">
            Use a different email
          </a>
        </div>
      </div>
    );
  }

  return (
    <form method="POST" action="/api/auth/request-code" className="space-y-4" onSubmit={handleEmailSubmit} noValidate>
      <FormField
        id="email"
        type="email"
        label="Email"
        value={email}
        onChange={(v) => {
          setEmail(v);
          if (errors.email) setErrors({});
        }}
        placeholder="you@example.com"
        error={errors.email}
        icon={<Mail className="size-4" />}
      />
      <ServerError message={serverError} />
      <SubmitButton pendingText="Sending code..." icon={<Send className="size-4" />}>
        Send code
      </SubmitButton>
    </form>
  );
}
