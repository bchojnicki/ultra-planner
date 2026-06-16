import { test, expect } from "@playwright/test";

// End-to-end flow for the gear-profile-units slice (S-03, Phase 5).
//
// Requires a real authenticated session, so it is gated behind TEST_EMAIL /
// TEST_PASSWORD (like tests/auth.spec.ts) and skips when they are unset.
// Run against LOCAL Supabase (the dev server reads .dev.vars) with a confirmed
// local user:
//   TEST_EMAIL=runner@test.local TEST_PASSWORD='runner123' npx playwright test tests/gear-units.spec.ts
//
// Known limitation: leaves the draft plan behind (plan deletion is S-05).

import type { Page } from "@playwright/test";

const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASSWORD;

async function waitHydrated(page: Page) {
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0, { timeout: 15000 });
}

async function addGear(page: Page, kind: string, fields: { name: string; [label: string]: string }) {
  await page.getByTestId("gear-add-kind").selectOption(kind);
  await page.getByTestId("gear-add-name").fill(fields.name);
  for (const [label, value] of Object.entries(fields)) {
    if (label === "name") continue;
    await page.getByLabel(label, { exact: true }).first().fill(value);
  }
  const before = await page.getByTestId("gear-row").count();
  await page.getByTestId("gear-add").click();
  await expect(page.getByTestId("gear-row")).toHaveCount(before + 1);
}

test.describe("Gear → unit-level output (requires TEST_EMAIL / TEST_PASSWORD)", () => {
  test.skip(!email || !password, "Set TEST_EMAIL and TEST_PASSWORD env vars to run this test");

  test("define gear, see units, limit + override, persist, reconcile on delete", async ({ page }) => {
    // Sign in.
    await page.goto("/auth/signin");
    await waitHydrated(page);
    await page.getByLabel("Email").fill(email ?? "");
    await page.getByLabel("Password", { exact: true }).fill(password ?? "");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/");

    // New plan with params that yield round carb numbers.
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "New plan" }).click();
    await page.waitForURL(/\/plans\/.+/);
    await waitHydrated(page);

    await page.getByLabel("Plan name").fill("Gear E2E");
    await page.getByLabel("Total distance (km)").fill("100");
    await page.getByLabel("Elevation gain (m)", { exact: true }).fill("2000");
    await page.getByLabel("Hourly carbs (g)").fill("60");
    await page.getByLabel("Expected finish hours").fill("10");
    await page.getByLabel("Expected finish minutes").fill("0");
    await expect(page.getByTestId("save-status").first()).toHaveText(/Saved/, { timeout: 5000 });

    // Define gear: a carb drink (ratio 1) and gels (ratio 2).
    await addGear(page, "drink", {
      name: "Tailwind",
      "Carbs / unit (g)": "80",
      "Fluid / serving (ml)": "500",
      "Carb ratio": "1",
    });
    await addGear(page, "gel", { name: "SIS gel", "Carbs / unit (g)": "20", "Carb ratio": "2" });

    // One station → two segments.
    await page.getByTestId("as-distance").fill("40");
    await page.getByTestId("as-gain").fill("1000");
    await page.getByTestId("as-add").click();
    await expect(page.getByTestId("station-row")).toHaveCount(1);

    // The plan table now shows a Fuel column with the unit breakdown (gels), and the
    // carbs cell shows achieved/target numbers.
    await expect(page.getByTestId("plan-table")).toBeVisible();
    await expect(page.getByTestId("fuel-cell").first()).toContainText("gel");
    await expect(page.getByTestId("carbs-cell").first()).toContainText("/");

    // Expand the first segment's gear panel and read the suggested gel count.
    await page.getByTestId("gear-toggle").first().click();
    const panel = page.getByTestId("gear-panel").first();
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("suggested");

    // Override the gel count to an unmistakable value for segment 1; it should win
    // immediately (optimistic), and the debounced PUT must land before we reload.
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/gear-selections") && r.request().method() === "PUT" && r.ok()),
      panel.getByLabel(/^Override SIS gel/).fill("3"),
    ]);
    await expect(page.getByTestId("fuel-cell").first()).toContainText("3× SIS gel", { timeout: 5000 });

    // Reload — the override persists.
    await page.reload();
    await waitHydrated(page);
    await expect(page.getByTestId("fuel-cell").first()).toContainText("3× SIS gel");

    // Delete the station → one segment. The table reconciles and still renders with a
    // re-suggested single Start → Finish row.
    await page.getByTestId("as-delete").first().click();
    await expect(page.getByTestId("station-row")).toHaveCount(0);
    await expect(page.getByTestId("plan-row")).toHaveCount(1);
    await expect(page.getByTestId("fuel-cell").first()).toContainText("gel");
  });
});
