import { test, expect } from "@playwright/test";

// End-to-end flow for deleting a saved plan (S-05, delete-saved-plan).
//
// Requires a local Supabase + Mailpit env; gated behind TEST_EMAIL (its presence
// signals that env) and skipped otherwise. Authenticates via the passwordless OTP
// helper (tests/helpers/otp.ts) with a unique throwaway email per run. Run:
//   TEST_EMAIL=1 npx playwright test tests/plan-delete.spec.ts

import type { Page } from "@playwright/test";
import { signInViaOtp, uniqueTestEmail } from "./helpers/otp";

const localEnv = process.env.TEST_EMAIL;

// React islands SSR with an `ssr` attribute that Astro removes once hydrated.
async function waitHydrated(page: Page) {
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0, { timeout: 15000 });
}

test.describe("Delete saved plan (requires TEST_EMAIL + local Supabase/Mailpit)", () => {
  test.skip(!localEnv, "Set TEST_EMAIL (and run local Supabase) to run this test");

  test("confirm dialog gates deletion; confirming removes the row", async ({ page }) => {
    await signInViaOtp(page, uniqueTestEmail());

    // Create a plan with a recognizable name.
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "New plan" }).click();
    await page.waitForURL(/\/plans\/.+\/edit$/);
    await waitHydrated(page);
    const id = new URL(page.url()).pathname.split("/")[2];
    const name = `Delete E2E ${Date.now()}`;
    await page.getByLabel("Plan name").fill(name);
    await expect(page.getByTestId("save-status")).toHaveText(/Saved/, { timeout: 5000 });

    // Back to the dashboard; the new plan's row is present.
    await page.goto("/dashboard");
    await waitHydrated(page);
    const row = page.locator('[data-testid="plan-row"]').filter({ has: page.locator(`a[href="/plans/${id}"]`) });
    await expect(row).toHaveCount(1);

    // Open the confirm modal — it names the plan.
    await row.getByTestId("plan-delete").click();
    await expect(page.getByTestId("plan-delete-confirm")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText(name);

    // Cancel leaves the plan in place.
    await page.getByTestId("plan-delete-cancel").click();
    await expect(page.getByTestId("plan-delete-confirm")).toHaveCount(0);
    await expect(page.locator(`a[href="/plans/${id}"]`)).toHaveCount(1);

    // Delete again and confirm — the row disappears with no reload.
    await row.getByTestId("plan-delete").click();
    await page.getByTestId("plan-delete-confirm").click();
    await expect(page.locator(`a[href="/plans/${id}"]`)).toHaveCount(0);

    // Reload confirms it's gone server-side too.
    await page.reload();
    await waitHydrated(page);
    await expect(page.locator(`a[href="/plans/${id}"]`)).toHaveCount(0);
  });
});
