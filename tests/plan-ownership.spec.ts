import { test, expect } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { signInViaOtp, uniqueTestEmail, waitHydrated } from "./helpers/otp";

// End-to-end route/HTTP authorization for Risk #4 (IDOR / ownership at the API
// boundary) from context/foundation/test-plan.md §2. test-plan.md §7 / §6.6 mark
// route-level authorization (HTTP 403/404/401 mapping) as deliberately e2e-only
// and deferred — this spec closes that gap. The DB/service layer is already
// proven cross-user in tests/integration/rls-ownership.test.ts (runner A / runner
// B); this test lifts the same two-user pattern to the browser + HTTP layer.
//
// Modeled on tests/seed.spec.ts — the exemplar: role-first locators, wait-for-
// state, Date.now() unique data, TEST_EMAIL gate, teardown in afterEach. It adds
// one thing the seed does not need: a second browser.newContext() so runner B's
// cookies/session never bleed into runner A's.
//
// Run: TEST_EMAIL=1 npx playwright test tests/plan-ownership.spec.ts

const localEnv = process.env.TEST_EMAIL;

test.describe("Plan ownership at the route boundary (requires TEST_EMAIL + local Supabase/Mailpit)", () => {
  test.skip(!localEnv, "Set TEST_EMAIL (and run local Supabase + Mailpit) to run this test");

  // Teardown state captured by the test. Cleanup runs even after a failed
  // assertion: delete runner A's plan through A's own session, then close both
  // contexts. Runner B creates no data of its own.
  let ownerContext: BrowserContext | null = null;
  let intruderContext: BrowserContext | null = null;
  let ownerPage: Page | null = null;
  let createdPlanId: string | null = null;

  test.afterEach(async () => {
    if (createdPlanId && ownerPage) {
      await ownerPage.request.delete(`/api/plans/${createdPlanId}`);
      createdPlanId = null;
    }
    if (ownerContext) {
      await ownerContext.close();
      ownerContext = null;
    }
    if (intruderContext) {
      await intruderContext.close();
      intruderContext = null;
    }
  });

  test("runner B cannot view or mutate runner A's plan (test-plan.md Risk #4)", async ({ browser }) => {
    test.slow(); // first navigation cold-compiles routes on the dev server

    // ── Setup: two isolated browser contexts so sessions/cookies never bleed.
    ownerContext = await browser.newContext();
    intruderContext = await browser.newContext();
    const pageA = await ownerContext.newPage();
    const pageB = await intruderContext.newPage();
    ownerPage = pageA;

    // ── Setup: runner A signs in and creates a fresh draft plan from the dashboard.
    await signInViaOtp(pageA, uniqueTestEmail("owner"));
    await pageA.goto("/dashboard");
    await pageA.getByRole("button", { name: "+ New plan" }).click();
    await pageA.waitForURL(/\/plans\/.+\/edit$/);
    await waitHydrated(pageA);
    const planAId = new URL(pageA.url()).pathname.split("/")[2];
    createdPlanId = planAId; // register for afterEach teardown

    // ── Setup: give A's plan a recognizable unique name and enough params to
    //    persist; wait for autosave to confirm "Saved".
    const planName = `Owner Plan ${Date.now()}`;
    await pageA.getByLabel("Plan name").fill(planName);
    await pageA.getByLabel("Total distance (km)", { exact: true }).fill("100");
    await pageA.getByLabel("Elevation gain (m)", { exact: true }).fill("2000");
    await pageA.getByLabel("Expected finish hours").fill("10");
    await pageA.getByLabel("Expected finish minutes").fill("0");
    await expect(pageA.getByTestId("save-status")).toHaveText(/Saved/);

    // ── Setup: runner A adds an aid station so the plan owns a child row too.
    await pageA.getByLabel("Cumulative distance (km)", { exact: true }).fill("50");
    await pageA.getByLabel("Cumulative elevation gain (m)", { exact: true }).fill("1200");
    await pageA.getByRole("button", { name: "Add aid station" }).click();
    await expect(pageA.getByTestId("station-row")).toHaveCount(1);

    // ── Setup: runner B signs in from the separate context.
    await signInViaOtp(pageB, uniqueTestEmail("intruder"));

    // ── Action + assertion: B opens A's editor URL. A non-owned id resolves to
    //    null server-side ⇒ Astro.redirect("/dashboard"), so B lands on their
    //    OWN dashboard and never sees A's plan. Fails if Risk #4 materializes
    //    (B renders A's editor).
    await pageB.goto(`/plans/${planAId}/edit`);
    await pageB.waitForURL(/\/dashboard$/);
    await expect(pageB).toHaveURL(/\/dashboard$/);
    await expect(pageB.getByText(planName)).toHaveCount(0);
    await expect(pageB.getByLabel("Plan name")).toHaveCount(0);

    // ── Action + assertion: same for the read-only plan view URL.
    await pageB.goto(`/plans/${planAId}`);
    await pageB.waitForURL(/\/dashboard$/);
    await expect(pageB).toHaveURL(/\/dashboard$/);
    await expect(pageB.getByText(planName)).toHaveCount(0);

    // ── Action + assertion: B attempts to mutate A's plan via the API, reusing
    //    B's authenticated session. The route must map the ownership failure to
    //    403/404 — never a 2xx. Fails if Risk #4 materializes (B's write is
    //    accepted).
    const patchRes = await pageB.request.fetch(`/api/plans/${planAId}`, {
      method: "PATCH",
      data: { name: `Hijacked by B ${Date.now()}` },
    });
    expect(patchRes.ok()).toBe(false);
    expect([403, 404]).toContain(patchRes.status());

    // ── Assertion: runner A re-opens their plan — the name is UNCHANGED, proving
    //    B's PATCH never landed.
    await pageA.goto(`/plans/${planAId}/edit`);
    await waitHydrated(pageA);
    await expect(pageA.getByLabel("Plan name")).toHaveValue(planName);
  });
});
