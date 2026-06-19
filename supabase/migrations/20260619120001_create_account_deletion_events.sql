-- Migration: create account_deletion_events
-- account-deletion: an audit record that a deletion occurred. Deliberately decoupled
-- from auth.users so it SURVIVES the cascade — user_id is a plain uuid column with NO
-- foreign key. A FK ON DELETE CASCADE would erase the audit row along with the user,
-- defeating the purpose (right-to-erasure evidence + abuse forensics).
--
-- email_hash (not the raw email) is stored to keep identifying PII out of the audit
-- trail while still allowing a deletion to be correlated on request.
--
-- Conventions (CLAUDE.md): RLS enabled with no authenticated/anon policies — only the
-- server-side service-role admin client writes here (service_role bypasses RLS).

create table account_deletion_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  email_hash   text not null,
  requested_ip inet,
  deleted_at   timestamptz not null default now()
);

alter table account_deletion_events enable row level security;
-- No policies: authenticated/anon are denied; the service-role admin path bypasses RLS.
