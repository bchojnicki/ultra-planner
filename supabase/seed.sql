-- Local development seed — runs automatically after migrations on `supabase db reset`.
--
-- Creates one confirmed test runner so a reset never leaves you without a login
-- (and so the Playwright e2e's TEST_EMAIL/TEST_PASSWORD user exists locally):
--   email:    runner@test.local
--   password: runner123
--
-- LOCAL ONLY. This writes directly into auth.users/auth.identities with a known
-- password hash — never run it against a hosted Supabase project. Idempotent:
-- re-running (another reset) is a no-op via ON CONFLICT.

-- Fixed UUID so the rows are stable across resets and the ON CONFLICT guards bite.
-- pgcrypto (crypt/gen_salt) lives in the `extensions` schema on Supabase.
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  -- GoTrue scans these into non-nullable Go strings; they have no column default,
  -- so leaving them NULL causes "Database error querying schema" on sign-in.
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
)
values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-1111-1111-111111111111',
  'authenticated',
  'authenticated',
  'runner@test.local',
  extensions.crypt('runner123', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(),
  now(),
  '',
  '',
  '',
  ''
)
on conflict (id) do nothing;

-- GoTrue requires a matching identity row for email/password sign-in. `email` is a
-- generated column (derived from identity_data), so it is intentionally omitted.
insert into auth.identities (
  id,
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
values (
  gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111',
  '11111111-1111-1111-1111-111111111111',
  '{"sub":"11111111-1111-1111-1111-111111111111","email":"runner@test.local","email_verified":true}',
  'email',
  now(),
  now(),
  now()
)
on conflict (provider_id, provider) do nothing;
