import { defineConfig } from "vitest/config";

// Node-side integration tests, kept separate from the Playwright e2e suite.
// `include` is scoped to tests/integration/**/*.test.ts so Playwright's
// tests/*.spec.ts files are never collected by Vitest (and vice versa).
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // RLS setup/teardown (admin user create/delete) is serial and stateful.
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
