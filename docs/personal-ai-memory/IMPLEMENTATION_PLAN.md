# Bindawasub AI Personal Memory — Isolated Implementation Plan

## Safety boundary
- This feature branch is separate from `main`.
- Do not deploy Edge Functions, apply migrations to production, alter provider execution, or change wallet/transaction behavior during development.
- Use synthetic fixtures and mocked catalog/provider responses.
- Do not configure development tools with production service-role secrets.
- Keep release disabled until the owner explicitly approves.

## Verified current architecture
- Main repository: `aliyubdw/bindawasub-ai`.
- Base commit inspected: `299ca6714aa8e4264c20f0e5c37be87a7585862a`.
- Existing Supabase project is healthy, but it is production and must not be used for experimental writes.
- Existing tables include `users` (including `auth_user_id` and `language`), `saved_beneficiaries`, `telegram_accounts`, `ai_conversations`, and `ai_messages`.
- Existing Telegram account linking maps a verified Telegram identity to an internal Bindawasub user.
- Existing data-purchase handling validates eligible catalog products and asks for explicit confirmation. Memory must not bypass those checks.

## MVP behavior
1. Customer can explicitly save, view, update, and delete preferences.
2. Preferences are keyed by internal `users.id`, not channel IDs or user-supplied names.
3. Reuse `users.language` for language preference and `saved_beneficiaries` for recipient contacts; avoid duplicate sources of truth.
4. Add a dedicated preferences table only after migrations and constraints are verified. Suggested fields: `user_id` (unique FK), `preferred_network`, `preferred_data_size`, `preferred_variant`, `default_beneficiary_id` (nullable FK), `personalization_enabled`, timestamps.
5. Preferences only help interpret requests. Every purchase must resolve the current active catalog and recipient on the server and require the existing explicit confirmation.
6. Web/app requests require their existing authenticated session. Telegram requests require a verified account link. Unlinked Telegram accounts cannot read or write customer preferences.
7. Provide controls equivalent to “My preferences”, “Forget this”, and “Turn off personalization”.

## Architecture approach
- Introduce a small server-side preference service, separate from provider execution.
- Keep channel adapters thin: resolve the authenticated internal user ID, call the preference service, format the response.
- Do not store raw conversation transcripts as long-term memory.
- Do not store credentials, wallet balance, payment data, or full transaction history in preferences.
- If personalization is disabled, do not use saved preferences to personalize a response or purchase proposal.
- Handle missing, stale, inactive, and ambiguous preferences by asking the customer; never guess.

## Security requirements
- Least-privilege grants and explicit RLS policies; test both allowed and denied paths.
- User A cannot read or mutate User B's preferences or beneficiaries.
- No preference endpoint accepts a caller-supplied user ID as proof of ownership.
- Never expose service-role keys to browser/app clients.
- Do not log full phone numbers or sensitive preference payloads.
- Validate every preference field against an allowlist and size limits.
- Deletion must actually remove the requested preference and stop future use.

## Test plan / release gates
- Unit tests: preference validation, allowed values, defaults, updates, deletion, disabled personalization.
- Identity tests: authenticated web/app session; correctly linked Telegram; unlinked Telegram; expired session; mismatched account.
- Isolation tests: cross-user read/write denied; beneficiary must belong to same user.
- Purchase tests: saved plan active; plan inactive; price changed; explicit request overrides memory; ambiguous beneficiary; stale confirmation; duplicate confirmation; provider failure.
- Channel contract tests: Telegram, website, and app produce equivalent preference behavior.
- All purchase tests use mocks. No real provider calls or wallet deductions.
- Verify the production code path remains unchanged while this branch is developed.
- Before release: staging test results, security review, migration review, feature flag default-off, rollback instructions, and explicit owner approval.

## Next engineering tasks
1. Inspect repository migration layout and current account/profile/beneficiary contracts.
2. Add pure preference validation and unit tests first.
3. Draft the migration and RLS policy for review; do not apply it to production.
4. Implement the server-side service behind a disabled feature flag.
5. Add mocked channel contract tests before any channel integration.
6. Test against an isolated non-production database only after environment isolation is verified.
