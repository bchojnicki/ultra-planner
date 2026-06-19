import React, { useEffect, useState } from "react";
import { Settings, LogOut, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useAccountDeletion } from "@/components/hooks/useAccountDeletion";

// Logged-in nav control (account-deletion). Replaces the bare Sign-out form with a
// Settings dropdown: Log out + a destructive Remove account that opens a confirm
// modal driving the OTP re-auth → email-link flow (see useAccountDeletion).
export default function SettingsMenu() {
  const [modalOpen, setModalOpen] = useState(false);
  const [code, setCode] = useState("");
  const { step, error, busy, requestCode, verifyCode, reset } = useAccountDeletion();

  function openModal() {
    reset();
    setCode("");
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

  async function logout() {
    await fetch("/api/auth/signout", { method: "POST" });
    window.location.assign("/");
  }

  // Escape closes the modal.
  useEffect(() => {
    if (!modalOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setModalOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [modalOpen]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="text-haze hover:text-snowcap focus-visible:ring-trail-violet flex items-center gap-1.5 transition-colors focus:outline-none focus-visible:ring-2"
          aria-label="Settings"
        >
          <Settings className="size-4" />
          Settings
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem onSelect={() => void logout()}>
            <LogOut className="size-4" />
            Log out
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={openModal}>
            <Trash2 className="size-4" />
            Remove account
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={closeModal}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-account-title"
            className="bg-summit-night text-haze w-full max-w-sm rounded-2xl border border-white/10 p-6"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <h2 id="remove-account-title" className="text-snowcap text-lg font-bold">
              Remove account
            </h2>

            {step === "confirm" ? (
              <div className="mt-3 space-y-4">
                <p className="text-haze/80 text-sm">
                  This permanently deletes your account and <strong>all</strong> of your plans, aid stations, and gear.
                  To confirm it’s you, we’ll email you a one-time code.
                </p>
                {error ? <p className="text-sm text-red-400">{error}</p> : null}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="text-haze/70 hover:text-snowcap rounded-lg px-3 py-2 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void requestCode()}
                    disabled={busy}
                    className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {busy ? "Sending…" : "Email me a code"}
                  </button>
                </div>
              </div>
            ) : step === "code" ? (
              <form
                className="mt-3 space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void verifyCode(code);
                }}
              >
                <p className="text-haze/80 text-sm">Enter the 6-digit code we emailed you.</p>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                  }}
                  placeholder="123456"
                  autoFocus
                  className="text-snowcap focus-visible:ring-trail-violet w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2"
                />
                {error ? <p className="text-sm text-red-400">{error}</p> : null}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="text-haze/70 hover:text-snowcap rounded-lg px-3 py-2 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy || !code.trim()}
                    className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {busy ? "Verifying…" : "Confirm deletion"}
                  </button>
                </div>
              </form>
            ) : (
              <div className="mt-3 space-y-4">
                <p className="text-haze/80 text-sm">
                  Check your email. We’ve sent a confirmation link — click it to permanently delete your account. The
                  link expires in 30 minutes.
                </p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="bg-trail-violet/15 text-snowcap hover:bg-trail-violet/25 rounded-lg border border-white/20 px-3 py-2 text-sm"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
