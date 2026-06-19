import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { signInViaOtp, uniqueTestEmail, waitHydrated } from "./helpers/otp";

const SAMPLE_GPX = fileURLToPath(new URL("./fixtures/sample.gpx", import.meta.url));

// Collapsible plan-builder sections (collapsible-plan-sections). Gated behind
// TEST_EMAIL (local Supabase + Mailpit) like the other flow specs. Proves the
// disclosure behavior: each section header toggles its body and aria-expanded,
// the collapsed state survives a reload (per-plan localStorage), and the Race
// save-status stays in the DOM while its section is collapsed.
const localEnv = process.env.TEST_EMAIL;

test.describe("Collapsible sections (requires TEST_EMAIL + local Supabase/Mailpit)", () => {
  test.skip(!localEnv, "Set TEST_EMAIL (and run local Supabase) to exercise the collapse flow");

  test("sections toggle, persist across reload, and keep the save-status visible", async ({ page }) => {
    test.slow(); // first navigation cold-compiles routes on the dev server

    await signInViaOtp(page, uniqueTestEmail());

    await page.goto("/dashboard");
    await page.getByRole("button", { name: "+ New plan" }).click();
    await page.waitForURL(/\/plans\/.+\/edit/);
    await waitHydrated(page);

    const raceHeader = page.getByRole("button", { name: "Race parameters" });
    const gearHeader = page.getByRole("button", { name: "Gear" });
    const stationsHeader = page.getByRole("button", { name: "Aid stations" });

    // All three start expanded.
    await expect(raceHeader).toHaveAttribute("aria-expanded", "true");
    await expect(gearHeader).toHaveAttribute("aria-expanded", "true");
    await expect(stationsHeader).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#gear-add-name")).toBeVisible();

    // Collapsing Gear hides its body and flips aria-expanded.
    await gearHeader.click();
    await expect(gearHeader).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#gear-add-name")).toBeHidden();

    // The collapsed state survives a full reload (per-plan localStorage); the
    // other sections stay expanded.
    await page.reload();
    await waitHydrated(page);
    await expect(page.getByRole("button", { name: "Gear" })).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#gear-add-name")).toBeHidden();
    await expect(page.getByRole("button", { name: "Race parameters" })).toHaveAttribute("aria-expanded", "true");

    // Collapsing Race hides its fields but the save-status indicator stays in the
    // header (outside the collapsed body).
    await page.getByRole("button", { name: "Race parameters" }).click();
    await expect(page.locator("#rsf-name")).toBeHidden();
    await expect(page.getByTestId("save-status")).toBeVisible();
  });

  test("a GPX import preserves the collapsed state of the remounted Aid stations section", async ({ page }) => {
    test.slow(); // first navigation cold-compiles routes on the dev server

    await signInViaOtp(page, uniqueTestEmail());

    await page.goto("/dashboard");
    await page.getByRole("button", { name: "+ New plan" }).click();
    await page.waitForURL(/\/plans\/.+\/edit/);
    await waitHydrated(page);

    // Collapse Aid stations before importing.
    await page.getByRole("button", { name: "Aid stations" }).click();
    await expect(page.getByRole("button", { name: "Aid stations" })).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#as-distance")).toBeHidden();

    // Import a GPX (fresh plan → no confirm). This remounts AidStationManager via
    // the importKey bump; the CollapsibleSection wrapper sits outside that key, so
    // the collapsed state must survive.
    await page.getByTestId("gpx-file").setInputFiles(SAMPLE_GPX);
    await expect(page.getByTestId("station-row")).toHaveCount(2); // import applied

    // Aid stations stays collapsed through the remount.
    await expect(page.getByRole("button", { name: "Aid stations" })).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#as-distance")).toBeHidden();
  });
});
