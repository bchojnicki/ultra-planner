import { test, expect } from "@playwright/test";

// End-to-end flow for the race-setup slice (S-01, Phase 3).
//
// Requires a real authenticated session, so it is gated behind TEST_EMAIL /
// TEST_PASSWORD (like tests/auth.spec.ts) and skips when they are unset.
// Run against LOCAL Supabase (the dev server reads .dev.vars) to avoid
// polluting the remote project — e.g. with a confirmed local user:
//   TEST_EMAIL=runner@test.local TEST_PASSWORD='…' npx playwright test tests/plans-setup.spec.ts
//
// Known limitation: the test deletes the aid stations it creates but leaves the
// draft plan behind (plan deletion is S-05).

import type { Page } from "@playwright/test";

const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASSWORD;

// React islands SSR with an `ssr` attribute that Astro removes once hydrated.
// Controlled inputs reset to their React state on hydrate, so filling before
// that races; wait until no island still carries `ssr`.
async function waitHydrated(page: Page) {
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0, { timeout: 15000 });
}

test.describe("Race setup + aid stations (requires TEST_EMAIL / TEST_PASSWORD)", () => {
  test.skip(!email || !password, "Set TEST_EMAIL and TEST_PASSWORD env vars to run this test");

  test("create plan, autosave params, add/delete stations", async ({ page }) => {
    // Sign in.
    await page.goto("/auth/signin");
    await waitHydrated(page);
    await page.getByLabel("Email").fill(email ?? "");
    await page.getByLabel("Password", { exact: true }).fill(password ?? "");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/");

    // Create a new plan from the dashboard.
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "New plan" }).click();
    await page.waitForURL(/\/plans\/.+/);
    await waitHydrated(page);

    // Edit parameters; expect the autosave indicator to reach "Saved".
    await page.getByLabel("Plan name").fill("E2E Test Plan");
    await page.getByLabel("Total distance (km)").fill("100");
    await expect(page.getByTestId("save-status")).toHaveText(/Saved/, { timeout: 5000 });

    // Reload — autosaved values persist.
    await page.reload();
    await waitHydrated(page);
    await expect(page.getByLabel("Plan name")).toHaveValue("E2E Test Plan");
    await expect(page.getByLabel("Total distance (km)")).toHaveValue("100");

    // Add two stations out of distance order.
    await page.getByTestId("as-distance").fill("80");
    await page.getByTestId("as-gain").fill("3000");
    await page.getByTestId("as-add").click();
    await expect(page.getByTestId("station-row")).toHaveCount(1);

    await page.getByTestId("as-distance").fill("30");
    await page.getByTestId("as-gain").fill("1000");
    await page.getByTestId("as-add").click();
    await expect(page.getByTestId("station-row")).toHaveCount(2);

    // They render sorted by cumulative distance (30 before 80).
    await expect(page.getByTestId("station-row").first()).toContainText("30 km");

    // Delete the first; the other remains.
    await page.getByTestId("as-delete").first().click();
    await expect(page.getByTestId("station-row")).toHaveCount(1);
    await expect(page.getByTestId("station-row").first()).toContainText("80 km");
  });
});
