import { test, expect } from "@playwright/test";

// End-to-end flow for the read-only saved-plan view (S-04, plan-dashboard-view).
//
// Requires a local Supabase + Mailpit env; gated behind TEST_EMAIL (its presence
// signals that env) and skipped otherwise. Authenticates via the passwordless OTP
// helper (tests/helpers/otp.ts) with a unique throwaway email per run. Run:
//   TEST_EMAIL=1 npx playwright test tests/plan-view.spec.ts
//
// Known limitation: the test leaves the draft plan behind (plan deletion is S-05).

import type { Page } from "@playwright/test";
import { signInViaOtp, uniqueTestEmail } from "./helpers/otp";

const localEnv = process.env.TEST_EMAIL;

// React islands SSR with an `ssr` attribute that Astro removes once hydrated.
// Controlled inputs reset to their React state on hydrate, so filling before
// that races; wait until no island still carries `ssr`.
async function waitHydrated(page: Page) {
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0, { timeout: 15000 });
}

test.describe("Read-only saved-plan view (requires TEST_EMAIL + local Supabase/Mailpit)", () => {
  test.skip(!localEnv, "Set TEST_EMAIL (and run local Supabase) to run this test");

  test("dashboard opens a plan read-only; Edit link returns to the editor", async ({ page }) => {
    await signInViaOtp(page, uniqueTestEmail());

    // Create a new plan — "New plan" now lands in the editor at /plans/<id>/edit.
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "New plan" }).click();
    await page.waitForURL(/\/plans\/.+\/edit$/);
    await waitHydrated(page);

    // The plan id is the path segment before /edit.
    const id = new URL(page.url()).pathname.split("/")[2];

    // Fill the params required to generate a table; wait for autosave to land.
    await page.getByLabel("Plan name").fill("Read-only E2E");
    await page.getByLabel("Total distance (km)").fill("100");
    await page.getByLabel("Elevation gain (m)", { exact: true }).fill("2000");
    await page.getByLabel("Hourly fluid (ml)").fill("500");
    await page.getByLabel("Expected finish hours").fill("10");
    await page.getByLabel("Expected finish minutes").fill("0");
    await expect(page.getByTestId("save-status")).toHaveText(/Saved/, { timeout: 5000 });

    // Open the plan from the dashboard — it must open read-only at /plans/<id> (not /edit).
    await page.goto("/dashboard");
    await page.locator(`a[href="/plans/${id}"]`).click();
    await page.waitForURL(new RegExp(`/plans/${id}$`));

    // The generated table renders…
    await expect(page.getByTestId("plan-table")).toBeVisible();
    await expect(page.getByTestId("plan-row").first()).toContainText("Start → Finish");
    // …and the view is non-editable: the editor's controls are absent (the global
    // `input` count is unreliable — the Astro dev toolbar injects its own inputs).
    await expect(page.getByLabel("Plan name")).toHaveCount(0);
    await expect(page.getByTestId("as-add")).toHaveCount(0);
    await expect(page.getByTestId("save-status")).toHaveCount(0);
    await expect(page.getByTestId("gear-toggle")).toHaveCount(0);

    // The "Edit plan" link returns to the editable editor.
    await page.getByRole("link", { name: "Edit plan" }).click();
    await page.waitForURL(new RegExp(`/plans/${id}/edit$`));
    await waitHydrated(page);
    await expect(page.getByLabel("Plan name")).toHaveValue("Read-only E2E");
  });
});
