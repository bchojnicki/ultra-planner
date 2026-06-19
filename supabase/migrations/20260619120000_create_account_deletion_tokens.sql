-- Migration: create account_deletion_tokens
-- account-deletion: single-use, expiring, user-scoped confirmation tokens for the
-- self-service account-deletion flow. A token is minted after OTP re-auth; the raw
-- value is emailed (Resend) and only its SHA-256 hash is stored here.
--
-- Conventions (CLAUDE.md):
--   - one RLS policy per operation per role; never FOR ALL, never USING (true)
--   - this table holds no policies at all: only the server-side service-role admin
--     client (src/lib/supabaseAdmin.ts) reads/writes it, and service_role bypasses
--     RLS. Enabling RLS with no authenticated/anon policies therefore denies the
--     anon SSR client entirely (defense in depth — the raw token never lives here).
--
-- Lifecycle: user_id FKs auth.users ON DELETE CASCADE, so a successful deletion
-- self-cleans the consumed token row along with the user.

create table account_deletion_tokens (
  token_hash   text primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  requested_ip inet,
  expires_at   timestamptz not null,
  used_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index account_deletion_tokens_user_id_idx on account_deletion_tokens (user_id);

alter table account_deletion_tokens enable row level security;
-- No policies: authenticated/anon are denied; the service-role admin path bypasses RLS.
