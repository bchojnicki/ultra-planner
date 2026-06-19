// @ts-check
import { defineConfig, envField } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
  adapter: cloudflare(),
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      // Server-only admin path for account deletion: the service-role key authorizes
      // auth.admin.deleteUser + token-table access (RLS-bypassing). Never exposed to the client.
      SUPABASE_SERVICE_ROLE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      // Resend transactional email (the custom deletion-confirmation link can't ride Supabase's
      // built-in auth templates). RESEND_FROM_EMAIL must be a verified sender/domain in Resend.
      RESEND_API_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      RESEND_FROM_EMAIL: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
