import { test, expect } from "@playwright/test";

test.describe("Sign in page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/auth/signin");
    // Wait for the React island to hydrate before interacting
    await page.waitForLoadState("networkidle");
  });

  test("renders form", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign up" })).toBeVisible();
  });

  test("validates empty email", async ({ page }) => {
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Email is required")).toBeVisible();
  });

  test("validates invalid email format", async ({ page }) => {
    await page.getByLabel("Email").fill("notanemail");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Enter a valid email address")).toBeVisible();
  });

  test("validates empty password", async ({ page }) => {
    await page.getByLabel("Email").fill("user@example.com");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Password is required")).toBeVisible();
  });

  test("clears field error when user types", async ({ page }) => {
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Email is required")).toBeVisible();
    await page.getByLabel("Email").fill("x");
    await expect(page.getByText("Email is required")).not.toBeVisible();
  });

  test("redirects back with error on bad credentials", async ({ page }) => {
    await page.getByLabel("Email").fill("nobody@example.com");
    await page.getByLabel("Password", { exact: true }).fill("wrongpassword");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/auth\/signin\?error=/, { timeout: 10_000 });
  });

  test("navigates to sign up", async ({ page }) => {
    await page.getByRole("link", { name: "Sign up" }).click();
    await expect(page).toHaveURL("/auth/signup");
  });
});

test.describe("Sign in — success (requires TEST_EMAIL / TEST_PASSWORD)", () => {
  test("redirects to home on valid credentials", async ({ page }) => {
    const email = process.env.TEST_EMAIL;
    const password = process.env.TEST_PASSWORD;
    test.skip(!email || !password, "Set TEST_EMAIL and TEST_PASSWORD env vars to run this test");

    await page.goto("/auth/signin");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Email").fill(email ?? "");
    await page.getByLabel("Password", { exact: true }).fill(password ?? "");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/");
  });
});

test.describe("Sign up page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/auth/signup");
    await page.waitForLoadState("networkidle");
  });

  test("renders form", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Sign up" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Confirm password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  });

  test("validates empty email", async ({ page }) => {
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Email is required")).toBeVisible();
  });

  test("validates invalid email format", async ({ page }) => {
    await page.getByLabel("Email").fill("notanemail");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Enter a valid email address")).toBeVisible();
  });

  test("validates password too short", async ({ page }) => {
    await page.getByLabel("Email").fill("user@example.com");
    await page.getByLabel("Password", { exact: true }).fill("abc");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Password must be at least 6 characters")).toBeVisible();
  });

  test("shows character countdown hint while typing short password", async ({ page }) => {
    await page.getByLabel("Password", { exact: true }).fill("abc");
    await expect(page.getByText(/more character/)).toBeVisible();
  });

  test("validates passwords do not match", async ({ page }) => {
    await page.getByLabel("Email").fill("user@example.com");
    await page.getByLabel("Password", { exact: true }).fill("password123");
    await page.getByLabel("Confirm password").fill("different");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Passwords do not match")).toBeVisible();
  });

  test("requires confirm password", async ({ page }) => {
    await page.getByLabel("Email").fill("user@example.com");
    await page.getByLabel("Password", { exact: true }).fill("password123");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Please confirm your password")).toBeVisible();
  });

  test("navigates to sign in", async ({ page }) => {
    await page.getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/auth/signin");
  });
});

test.describe("Protected routes", () => {
  test("redirects unauthenticated user from /dashboard to sign in", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL("/auth/signin");
  });
});

test.describe("Confirm email page", () => {
  test("renders with link back to sign in", async ({ page }) => {
    await page.goto("/auth/confirm-email");
    await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();
  });
});
