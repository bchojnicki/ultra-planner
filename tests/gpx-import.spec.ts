import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { signInViaOtp, uniqueTestEmail, waitHydrated } from "./helpers/otp";

const SAMPLE_GPX = fileURLToPath(new URL("./fixtures/sample.gpx", import.meta.url));

// End-to-end GPX import (gpx-import, Phase 5). Gated behind TEST_EMAIL (its
// presence signals a local Supabase + Mailpit environment), like the OTP flow
// tests. Proves the browser-side parse → import → state-refresh path: a fixture
// GPX populates the race details, replaces the stations with the named
// waypoints, and the plan table renders the loss column.
const localEnv = process.env.TEST_EMAIL;

test.describe("GPX import (requires TEST_EMAIL + local Supabase/Mailpit)", () => {
  test.skip(!localEnv, "Set TEST_EMAIL (and run local Supabase) to exercise the GPX import flow");

  test("uploading a GPX populates race details, stations, and the loss column", async ({ page }) => {
    // Triple the timeout: the first navigation against a cold `astro dev` server
    // compiles routes/islands on demand, which can exceed the default 30s.
    test.slow();

    await signInViaOtp(page, uniqueTestEmail());

    // Create a fresh draft plan → lands on the editor.
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "+ New plan" }).click();
    await page.waitForURL(/\/plans\/.+\/edit/);
    await waitHydrated(page);

    // A fresh plan has no existing data, so the import applies without a confirm.
    await page.getByTestId("gpx-file").setInputFiles(SAMPLE_GPX);

    // Race details auto-fill from the track (elevation is an exact delta-sum:
    // +500 −300 +200 −300 → gain 700, loss 600; distance ≈ 222 km from 2° lon).
    await expect(page.locator("#rsf-total_elevation_gain_m")).toHaveValue("700");
    await expect(page.locator("#rsf-total_elevation_loss_m")).toHaveValue("600");
    await expect(page.locator("#rsf-total_distance_km")).not.toHaveValue("0");

    // Stations replaced with the two named waypoints.
    await expect(page.getByTestId("station-row")).toHaveCount(2);
    await expect(page.getByText("Aid Alpha")).toBeVisible();
    await expect(page.getByText("Aid Bravo")).toBeVisible();

    // The plan table needs an expected finish time to render; once set it shows
    // the new Loss column alongside Gain.
    await page.getByLabel("Expected finish hours").fill("30");
    await expect(page.getByRole("columnheader", { name: "Loss" })).toBeVisible();
  });
});
