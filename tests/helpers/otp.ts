import { expect, type Page } from "@playwright/test";

// Shared passwordless-OTP sign-in helper for the gated e2e specs (email-otp-auth / S-06).
// Runs against LOCAL Supabase: requests a code via the UI, reads it from the local
// mail server (Mailpit, on the [inbucket] port), and verifies it. Use a UNIQUE email
// per test (signInWithOtp creates the user on first use) so its mailbox starts empty
// and parallel workers don't collide on the send rate limit or read a stale code.

const MAIL_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

// A throwaway address for a single test run; the unique local part means a fresh mailbox.
export function uniqueTestEmail(prefix = "e2e"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

export async function waitHydrated(page: Page): Promise<void> {
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0, { timeout: 15000 });
}

interface MailpitMessage {
  ID: string;
  Created: string;
}

// Newest message id addressed to `email`, via Mailpit's search API, or null if none yet.
async function latestMessageId(email: string): Promise<string | null> {
  const res = await fetch(`${MAIL_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { messages?: MailpitMessage[] };
  const msgs = [...(data.messages ?? [])].sort((a, b) => new Date(b.Created).getTime() - new Date(a.Created).getTime());
  return msgs[0]?.ID ?? null;
}

// Poll Mailpit until the OTP email for `email` arrives, then extract its 6-digit code.
async function waitForOtpCode(email: string): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const id = await latestMessageId(email);
    if (id) {
      const res = await fetch(`${MAIL_URL}/api/v1/message/${id}`);
      if (res.ok) {
        const msg = (await res.json()) as { Text?: string; HTML?: string };
        const haystack = `${msg.HTML ?? ""}\n${msg.Text ?? ""}`;
        const match = /\b(\d{6})\b/.exec(haystack);
        if (match) return match[1];
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No OTP email for "${email}" in Mailpit within timeout`);
}

// Full sign-in: email step → request code → read it from Mailpit → verify → land on "/".
export async function signInViaOtp(page: Page, email: string): Promise<void> {
  await page.goto("/auth/signin");
  await waitHydrated(page);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.waitForURL(/step=verify/);
  await waitHydrated(page);

  const code = await waitForOtpCode(email);
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: /Verify/ }).click();
  await page.waitForURL("/");
}
