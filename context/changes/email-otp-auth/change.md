---
change_id: email-otp-auth
title: Passwordless email OTP (6-digit code) authentication
status: implementing
created: 2026-06-17
updated: 2026-06-17
archived_at: null
---

## Notes

Switch authentication from email + password to **passwordless email OTP** (Supabase `signInWithOtp` → emailed 6-digit code → `verifyOtp`). No passwords are stored or managed. Same flow serves both first-time sign-up and returning sign-in (no separate signup form, no password-reset flow).

This replaces the existing password scaffold (`signInWithPassword`/`signUp`, `confirm-email`, the password React forms). It realigns the PRD/roadmap with the original `shape-notes.md` passwordless intent — the only change from that original is OTP **code** instead of magic **link** (chosen for better cross-device/email-client behavior).

Scope (decided 2026-06-17): reconcile foundation docs (PRD auth FRs/US + Access Control, roadmap S-06 + baseline, mechanism wording in shape-notes/tech-stack/infrastructure) → then `/10x-plan` → implement (replacing the password scaffold). Roadmap S-06 change-id renamed `email-password-auth` → `email-otp-auth`.
