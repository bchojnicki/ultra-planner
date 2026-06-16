import { test, expect } from "@playwright/test";

// End-to-end flow for the read-only saved-plan view (S-04, plan-dashboard-view).
//
// Requires a real authenticated session, so it is gated behind TEST_EMAIL /
// TEST_PASSWORD (like tests/auth.spec.ts) and skips when they are unset.
// Run against LOCAL Supabase (the dev server reads .dev.vars) to avoid
// polluting the remote project — e.g. with a confirmed local user:
//   TEST_EMAIL=runner@test.local TEST_PASSWORD='…' npx playwright test tests/plan-view.spec.ts
//
// Known limitation: the test leaves the draft plan behind (plan deletion is S-05).

import type { Page } from "@playwright/test";

const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASSWORD;

// React islands SSR with an `ssr` attribute that Astro removes once hydrated.
// Controlled inputs reset to their React state on hydrate, so filling before
// that races; wait until no island still carries `ssr`.
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

test.describe("Read-only saved-plan view (requires TEST_EMAIL / TEST_PASSWORD)", () => {
  test.skip(!email || !password, "Set TEST_EMAIL and TEST_PASSWORD env vars to run this test");

  test("dashboard opens a plan read-only; Edit link returns to the editor", async ({ page }) => {
    await signIn(page);

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
