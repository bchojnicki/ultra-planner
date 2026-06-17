import { test, expect } from "@playwright/test";
import { signInViaOtp, uniqueTestEmail, waitHydrated } from "./helpers/otp";

// Passwordless email-OTP auth (email-otp-auth / S-06). The render/validation tests
// need no backend; the flow tests hit Supabase + Mailpit and are gated behind
// TEST_EMAIL (its presence signals a local Supabase + Mailpit environment). Each
// gated test uses a unique throwaway email — signInWithOtp creates the user.
const localEnv = process.env.TEST_EMAIL;

test.describe("Sign in page (email step)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/auth/signin");
    await page.waitForLoadState("networkidle");
  });

  test("renders the email-only form (no password, no separate sign-up)", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send code" })).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Sign up" })).toHaveCount(0);
  });

  test("validates empty email", async ({ page }) => {
    await page.getByRole("button", { name: "Send code" }).click();
    await expect(page.getByText("Email is required")).toBeVisible();
  });

  test("validates invalid email format", async ({ page }) => {
    await page.getByLabel("Email").fill("notanemail");
    await page.getByRole("button", { name: "Send code" }).click();
    await expect(page.getByText("Enter a valid email address")).toBeVisible();
  });

  test("clears field error when user types", async ({ page }) => {
    await page.getByRole("button", { name: "Send code" }).click();
    await expect(page.getByText("Email is required")).toBeVisible();
    await page.getByLabel("Email").fill("x");
    await expect(page.getByText("Email is required")).not.toBeVisible();
  });
});

test.describe("Passwordless OTP flow (requires TEST_EMAIL + local Supabase/Mailpit)", () => {
  test.skip(!localEnv, "Set TEST_EMAIL (and run local Supabase) to exercise the OTP flow");

  test("requesting a code advances to the code-entry step", async ({ page }) => {
    await page.goto("/auth/signin");
    await waitHydrated(page);
    await page.getByLabel("Email").fill(uniqueTestEmail());
    await page.getByRole("button", { name: "Send code" }).click();
    await page.waitForURL(/step=verify/);
    await waitHydrated(page);
    await expect(page.getByLabel("6-digit code")).toBeVisible();
  });

  test("an invalid code shows an inline error", async ({ page }) => {
    await page.goto("/auth/signin");
    await waitHydrated(page);
    await page.getByLabel("Email").fill(uniqueTestEmail());
    await page.getByRole("button", { name: "Send code" }).click();
    await page.waitForURL(/step=verify/);
    await waitHydrated(page);
    await page.getByLabel("6-digit code").fill("000000");
    await page.getByRole("button", { name: /Verify/ }).click();
    await expect(page.getByText(/invalid or expired/i)).toBeVisible();
  });

  test("signs in with a valid code from Mailpit", async ({ page }) => {
    await signInViaOtp(page, uniqueTestEmail());
    await expect(page).toHaveURL("/");
  });
});

test.describe("Protected routes", () => {
  test("redirects unauthenticated user from /dashboard to sign in", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL("/auth/signin");
  });
});
