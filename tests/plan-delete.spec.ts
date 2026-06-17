import { test, expect } from "@playwright/test";

// End-to-end flow for deleting a saved plan (S-05, delete-saved-plan).
//
// Requires a real authenticated session, so it is gated behind TEST_EMAIL /
// TEST_PASSWORD (like tests/auth.spec.ts) and skips when they are unset.
// Run against LOCAL Supabase (the dev server reads .dev.vars) to avoid
// polluting the remote project — e.g. with a confirmed local user:
//   TEST_EMAIL=runner@test.local TEST_PASSWORD='…' npx playwright test tests/plan-delete.spec.ts

import type { Page } from "@playwright/test";

const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASSWORD;

// React islands SSR with an `ssr` attribute that Astro removes once hydrated.
async function waitHydrated(page: Page) {
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0, { timeout: 15000 });
}

async function signIn(page: Page) {
  await page.goto("/auth/signin");
  await waitHydrated(page);
  await page.getByLabel("Email").fill(email ?? "");
  await page.getByLabel("Password", { exact: true }).fill(password ?? "");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");
}

test.describe("Delete saved plan (requires TEST_EMAIL / TEST_PASSWORD)", () => {
  test.skip(!email || !password, "Set TEST_EMAIL and TEST_PASSWORD env vars to run this test");

  test("confirm dialog gates deletion; confirming removes the row", async ({ page }) => {
    await signIn(page);

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
