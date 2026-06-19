import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "astro:env/server";
import type { Database } from "@/types";

// Server-only service-role client. Distinct from src/lib/supabase.ts (the cookie-bound,
// anon, RLS-enforced SSR client used for normal user requests): this one carries the
// service_role key, so it BYPASSES RLS and can call auth.admin.* (e.g. deleteUser).
//
// SECURITY: never import this module from a client island or return the key to the
// browser. It is used only inside server endpoints (prerender = false) for account
// deletion — token-table access and the irreversible auth.users delete.
//
// Workers: admin REST calls are plain fetch (no Node APIs / websockets). We bind the
// runtime's global fetch and disable session persistence/refresh so the client never
// touches cookies or storage.
export function createAdminClient(): SupabaseClient<Database> | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  return createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: fetch.bind(globalThis) },
  });
}
