import { test, expect } from "@playwright/test";
import { signInViaOtp, uniqueTestEmail, waitHydrated } from "./helpers/otp";

// ─────────────────────────────────────────────────────────────────────────────
// SEED TEST — the exemplar every generated E2E test is modeled on.
//
// "What you show is what you get." If this file uses getByRole, generated tests
// do too. If it had page.waitForTimeout(), every generated test would inherit
// that anti-pattern. Keep it exemplary. See .claude/skills/10x-e2e/references/
// seed-test-pattern.md and the "10xDevs AI Toolkit — Module 3, Lesson 4" block
// in CLAUDE.md.
//
// The five conventions this seed demonstrates:
//   1. Role-first locators — getByRole / getByLabel / getByText. getByTestId
//      only where the element has no accessible name (the plan-table rows), and
//      never CSS selectors, XPath, or DOM structure.
//   2. Test independence — one full cycle (setup → action → assertion → cleanup)
//      inside a single test. No test relies on another having run.
//   3. Wait for state, never time — toBeVisible(), toHaveText(), toHaveCount(),
//      waitForURL(). Never page.waitForTimeout().
//   4. Unique test data — a Date.now()-stamped plan name so parallel workers and
//      re-runs after a crash never collide.
//   5. Risk-tied name + cleanup in afterEach — the test title names the
//      test-plan.md risk it protects; the plan it creates is torn down whether
//      the test passed or failed.
//
// Auth: Playwright's documented ideal is storageState (log in once in a setup
// project, reuse the cookie). This app's only auth is passwordless email OTP,
// which needs a running Mailpit, so the shared signInViaOtp helper is the
// convention here — the login flow lives in ONE place, not copy-pasted per test.
// A `setup` project that writes storageState is the upgrade path if OTP login
// ever dominates the suite runtime.
//
// Gated like every other flow spec: requires local Supabase + Mailpit, so it is
// skipped unless TEST_EMAIL is set. Run:
//   TEST_EMAIL=1 npx playwright test tests/seed.spec.ts
// ─────────────────────────────────────────────────────────────────────────────

const localEnv = process.env.TEST_EMAIL;

test.describe("E2E seed (requires TEST_EMAIL + local Supabase/Mailpit)", () => {
  test.skip(!localEnv, "Set TEST_EMAIL (and run local Supabase + Mailpit) to run this test");

  // Cleanup runs even when an assertion above failed — the plan created in the
  // test is captured here and removed via its own session. This is teardown, not
  // a code path under test, so hitting the API directly is fine.
  let createdPlanId: string | null = null;

  test.afterEach(async ({ page }) => {
    if (!createdPlanId) return;
    await page.request.delete(`/api/plans/${createdPlanId}`);
    createdPlanId = null;
  });

  test("plan segments re-derive from sorted aid stations when added out of order (test-plan.md Risk #5)", async ({
    page,
  }) => {
    test.slow(); // first navigation cold-compiles routes on the dev server

    // ── Setup: authenticate, then create a fresh draft plan from the dashboard.
    await signInViaOtp(page, uniqueTestEmail());

    await page.goto("/dashboard");
    await page.getByRole("button", { name: "+ New plan" }).click();
    await page.waitForURL(/\/plans\/.+\/edit$/);
    await waitHydrated(page);
    createdPlanId = new URL(page.url()).pathname.split("/")[2];

    // ── Setup: enough race parameters that the plan table generates. Unique name
    //    so parallel runs don't collide; wait for autosave to confirm "Saved".
    const planName = `Seed Plan ${Date.now()}`;
    await page.getByLabel("Plan name").fill(planName);
    await page.getByLabel("Total distance (km)", { exact: true }).fill("100");
    // exact:true — "Elevation gain (m)" is otherwise a substring of the aid
    // station field "Cumulative elevation gain (m)".
    await page.getByLabel("Elevation gain (m)", { exact: true }).fill("2000");
    await page.getByLabel("Expected finish hours").fill("10");
    await page.getByLabel("Expected finish minutes").fill("0");
    await expect(page.getByTestId("save-status")).toHaveText(/Saved/);

    // ── Action: add two aid stations OUT of distance order (70 km, then 25 km).
    //    Risk #5 is that a mutation feeds the calc in entry order instead of
    //    re-sorting and re-deriving each segment.
    await page.getByLabel("Cumulative distance (km)", { exact: true }).fill("70");
    await page.getByLabel("Cumulative elevation gain (m)", { exact: true }).fill("2100");
    await page.getByRole("button", { name: "Add aid station" }).click();
    await expect(page.getByTestId("station-row")).toHaveCount(1);

    await page.getByLabel("Cumulative distance (km)").fill("25");
    await page.getByLabel("Cumulative elevation gain (m)").fill("800");
    await page.getByRole("button", { name: "Add aid station" }).click();
    await expect(page.getByTestId("station-row")).toHaveCount(2);

    // ── Assertion: the business outcome that fails if Risk #5 materializes.
    //    Stations render sorted (25 km before 70 km)…
    await expect(page.getByTestId("station-row").first()).toContainText("25 km");

    //    …and the plan table has three segments whose first leg is Start → AS1
    //    at 25 km. If the calc used entry order, the first leg would be 70 km.
    const rows = page.getByTestId("plan-row");
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText("Start → AS1");
    await expect(rows.first()).toContainText("25 km");
    await expect(page.getByTestId("plan-totals")).toContainText("100 km");

    // ── Assertion survives a real SSR reload (segments are persisted + re-derived
    //    server-side, not just live island state).
    await page.reload();
    await waitHydrated(page);
    await expect(page.getByTestId("plan-row").first()).toContainText("25 km");
  });
});
