import { test, expect } from "@playwright/test";

// Public legal pages (legal-pages). These routes are outside PROTECTED_ROUTES and
// need no auth, so — unlike the plan-* specs — they are not gated behind TEST_EMAIL.
// They guard against a future 404 or a removed footer/sign-in link.

test.describe("Legal pages", () => {
  test("privacy policy page renders with the erasure link", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { name: "Privacy Policy", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Settings → Remove account" })).toHaveAttribute(
      "href",
      "/account/delete/confirm",
    );
  });

  test("terms of use page renders with the safety disclaimer", async ({ page }) => {
    await page.goto("/terms");
    await expect(page.getByRole("heading", { name: "Terms of Use", level: 1 })).toBeVisible();
    await expect(page.getByText("IMPORTANT — PLANNING AID ONLY")).toBeVisible();
  });

  test("footer links to privacy and terms", async ({ page }) => {
    await page.goto("/about");
    const footer = page.locator("footer");
    await expect(footer.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    await expect(footer.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  });

  test("sign-in page shows the acceptance notice", async ({ page }) => {
    await page.goto("/auth/signin");
    await expect(page.getByText("By continuing, you agree")).toBeVisible();
  });
});
