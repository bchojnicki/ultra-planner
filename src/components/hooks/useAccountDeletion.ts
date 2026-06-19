import { useState } from "react";

// Drives the client side of the account-deletion flow (account-deletion):
//   confirm → requestCode() POSTs /api/account/deletion/request (OTP re-auth)
//   code    → verifyCode() POSTs /api/account/deletion/verify (issues + emails link)
//   sent    → "check your email" terminal state
// Network/HTTP failures surface as a human-readable `error`; `busy` gates the buttons.
export type DeletionStep = "confirm" | "code" | "sent";

export function useAccountDeletion() {
  const [step, setStep] = useState<DeletionStep>("confirm");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setStep("confirm");
    setError(null);
    setBusy(false);
  }

  async function requestCode() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/deletion/request", { method: "POST" });
      if (res.ok) {
        setStep("code");
      } else if (res.status === 429) {
        setError(
          "A deletion request is already in progress, or codes were requested too quickly. Check your email or wait a moment.",
        );
      } else {
        setError("Couldn't start account deletion. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(code: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/deletion/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      if (res.ok) {
        setStep("sent");
      } else if (res.status === 400) {
        setError("That code is invalid or expired. Request a new one.");
      } else {
        setError("Couldn't send the confirmation email. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return { step, error, busy, requestCode, verifyCode, reset };
}
