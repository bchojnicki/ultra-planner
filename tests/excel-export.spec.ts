import { test, expect } from "@playwright/test";
import { statSync } from "node:fs";

// End-to-end flow for the Excel export button on the read-only saved-plan view
// (excel-export / S-12).
//
// Requires a local Supabase + Mailpit env; gated behind TEST_EMAIL (its presence
// signals that env) and skipped otherwise. Authenticates via the passwordless OTP
// helper (tests/helpers/otp.ts) with a unique throwaway email per run. Run:
//   TEST_EMAIL=1 npx playwright test tests/excel-export.spec.ts
//
// Known limitation: the tests leave the draft plan behind (plan deletion is S-05).

import type { Page } from "@playwright/test";
import { signInViaOtp, uniqueTestEmail } from "./helpers/otp";

const localEnv = process.env.TEST_EMAIL;

// React islands SSR with an `ssr` attribute that Astro removes once hydrated.
async function waitHydrated(page: Page) {
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0, { timeout: 15000 });
}

// Create a fresh plan in the editor and return its id. Fills the name always;
// fills the table-generating params only when `generate` is true.
async function createPlan(page: Page, name: string, generate: boolean): Promise<string> {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "New plan" }).click();
  await page.waitForURL(/\/plans\/.+\/edit$/);
  await waitHydrated(page);
  const id = new URL(page.url()).pathname.split("/")[2];

  await page.getByLabel("Plan name").fill(name);
  if (generate) {
    await page.getByLabel("Total distance (km)").fill("100");
    await page.getByLabel("Elevation gain (m)", { exact: true }).fill("2000");
    await page.getByLabel("Hourly fluid (ml)").fill("500");
    await page.getByLabel("Expected finish hours").fill("10");
    await page.getByLabel("Expected finish minutes").fill("0");
  }
  await expect(page.getByTestId("save-status")).toHaveText(/Saved/, { timeout: 5000 });
  return id;
}

test.describe("Excel export (requires TEST_EMAIL + local Supabase/Mailpit)", () => {
  test.skip(!localEnv, "Set TEST_EMAIL (and run local Supabase) to run this test");

  test("a generated plan shows the Export button and downloads an .xlsx", async ({ page }) => {
    await signInViaOtp(page, uniqueTestEmail());
    const id = await createPlan(page, "Excel Export E2E", true);

    await page.goto(`/plans/${id}`);
    await page.waitForURL(new RegExp(`/plans/${id}$`));
    await expect(page.getByTestId("plan-table")).toBeVisible();

    const exportButton = page.getByTestId("export-excel");
    await expect(exportButton).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await exportButton.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe("Excel Export E2E.xlsx");
    const path = await download.path();
    expect(path).toBeTruthy();
    if (path) expect(statSync(path).size).toBeGreaterThan(0);
  });

  test("a plan that cannot generate has no Export button", async ({ page }) => {
    await signInViaOtp(page, uniqueTestEmail());
    const id = await createPlan(page, "Excel Export Ungenerated", false);

    await page.goto(`/plans/${id}`);
    await page.waitForURL(new RegExp(`/plans/${id}$`));

    // The view renders the missing-params error panel instead of the table…
    await expect(page.getByTestId("plan-table-error")).toBeVisible();
    // …and the export button is absent.
    await expect(page.getByTestId("export-excel")).toHaveCount(0);
  });
});
