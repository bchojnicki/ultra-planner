import { test, expect } from "@playwright/test";
import { signInViaOtp, uniqueTestEmail, waitHydrated } from "./helpers/otp";

// End-to-end aid-station editing (edit-aid-stations, Phase 2). Gated behind
// TEST_EMAIL (local Supabase + Mailpit), like the other flow specs. Proves the
// inline-edit path: open a station, change fields with autosave that persists,
// and a distance-validation error that blocks the save.
const localEnv = process.env.TEST_EMAIL;

test.describe("Aid station editing (requires TEST_EMAIL + local Supabase/Mailpit)", () => {
  test.skip(!localEnv, "Set TEST_EMAIL (and run local Supabase) to exercise the edit flow");

  test("edits persist via autosave; an invalid distance is blocked", async ({ page }) => {
    test.slow(); // first navigation cold-compiles routes on the dev server

    await signInViaOtp(page, uniqueTestEmail());

    // Fresh plan → editor.
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "+ New plan" }).click();
    await page.waitForURL(/\/plans\/.+\/edit/);
    await waitHydrated(page);

    // Total distance gives the edit-time bound; then add a station to edit.
    await page.locator("#rsf-total_distance_km").fill("100");
    await page.locator("#as-distance").fill("40");
    await page.locator("#as-gain").fill("1000");
    await page.getByTestId("as-add").click();
    await expect(page.getByTestId("station-row")).toHaveCount(1);

    // Open the editor, change notes + a facility → autosaves.
    await page.getByTestId("as-edit").click();
    await expect(page.getByTestId("as-edit-panel")).toBeVisible();
    await page.getByTestId("as-edit-notes").fill("water + drop bag here");
    await page.getByTestId("as-edit-flag-drop_bag_available").check();
    await expect(page.getByTestId("as-edit-status")).toContainText("Saved");

    // Close the editor; the row reflects the edit and it persists across reload.
    await page.getByTestId("as-edit").click(); // "Done"
    await expect(page.getByTestId("station-row")).toContainText("water + drop bag here");
    await page.reload();
    await waitHydrated(page);
    await expect(page.getByTestId("station-row")).toContainText("water + drop bag here");

    // Invalid distance (0) shows an inline error and does not persist.
    await page.getByTestId("as-edit").click();
    await page.getByTestId("as-edit-cumulative_distance_km").fill("0");
    await expect(page.getByTestId("as-edit-error")).toBeVisible();
    await page.getByTestId("as-edit").click(); // Done — invalid draft discarded
    await page.reload();
    await waitHydrated(page);
    await expect(page.getByTestId("station-row")).toContainText("40 km");
  });
});
