import { test, expect } from "@playwright/test";

// End-to-end flow for the race-setup slice (S-01, Phase 3).
//
// Requires a local Supabase + Mailpit env; gated behind TEST_EMAIL (its presence
// signals that env) and skipped otherwise. Authenticates via the passwordless OTP
// helper (tests/helpers/otp.ts) with a unique throwaway email per run. Run:
//   TEST_EMAIL=1 npx playwright test tests/plans-setup.spec.ts
//
// Known limitation: the test deletes the aid stations it creates but leaves the
// draft plan behind (plan deletion is S-05).

import type { Page } from "@playwright/test";
import { signInViaOtp, uniqueTestEmail } from "./helpers/otp";

const localEnv = process.env.TEST_EMAIL;

// React islands SSR with an `ssr` attribute that Astro removes once hydrated.
// Controlled inputs reset to their React state on hydrate, so filling before
// that races; wait until no island still carries `ssr`.
async function waitHydrated(page: Page) {
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0, { timeout: 15000 });
}

test.describe("Race setup + aid stations (requires TEST_EMAIL + local Supabase/Mailpit)", () => {
  test.skip(!localEnv, "Set TEST_EMAIL (and run local Supabase) to run this test");

  test("create plan, autosave params, add/delete stations", async ({ page }) => {
    await signInViaOtp(page, uniqueTestEmail());

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

  test("generates a correct plan table", async ({ page }) => {
    await signInViaOtp(page, uniqueTestEmail());

    await page.goto("/dashboard");
    await page.getByRole("button", { name: "New plan" }).click();
    await page.waitForURL(/\/plans\/.+/);
    await waitHydrated(page);

    // Required params (worked reference): 100 km, 2000 m gain, 10h, hourly fluid 500 ml.
    await page.getByLabel("Plan name").fill("Table E2E");
    await page.getByLabel("Total distance (km)").fill("100");
    await page.getByLabel("Elevation gain (m)", { exact: true }).fill("2000");
    await page.getByLabel("Hourly fluid (ml)").fill("500");
    await page.getByLabel("Expected finish hours").fill("10");
    await page.getByLabel("Expected finish minutes").fill("0");

    // One station at 40 km / 1000 m (rest 0).
    await page.getByTestId("as-distance").fill("40");
    await page.getByTestId("as-gain").fill("1000");
    await page.getByTestId("as-add").click();
    await expect(page.getByTestId("station-row")).toHaveCount(1);

    // Live table: seg1 = Start→AS1, 40 km, fluid = 500·(250/60) ≈ 2083 ml; totals 100 km.
    await expect(page.getByTestId("plan-table")).toBeVisible();
    const firstRow = page.getByTestId("plan-row").first();
    await expect(firstRow).toContainText("Start → AS1");
    await expect(firstRow).toContainText("40 km");
    await expect(firstRow).toContainText("2083 ml");
    await expect(page.getByTestId("plan-totals")).toContainText("100 km");
  });
});
