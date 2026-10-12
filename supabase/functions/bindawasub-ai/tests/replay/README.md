# Replay corpus

Real customer messages, masked, replayed through the web chat backend and the Telegram webhook
(`../replay_test.ts`). Mock-only: no network, no provider calls, no real purchases.

## What is checked
Every message, whatever the model says: no crash, a non-empty answer, no purchase from a single
message, exactly one saved reply equal to the answer, no ₦ amount that is not a catalog price / the
wallet balance / a number the customer wrote, and no confirmation before a plan is chosen.
`snapshot.json` records how each message is routed (backend vs Gemini fallback, intent) so a silent
regression shows up as a diff.

## Privacy rules (enforced by the "privacy guard" test)
- Phone numbers are `<PHONE>` (or `<SHORTPHONE>` for a deliberately invalid one); the test substitutes fakes.
- No emails, no 9+ digit numbers (smartcard / meter / account numbers), no IDs, no personal names.
- Saved-contact nicknames such as "Num" are fine; they match the mock contacts.

## Refreshing the corpus (read-only SQL on the production database)
```sql
with masked as (
  select c.channel,
    regexp_replace(regexp_replace(regexp_replace(trim(m.message), '(\+?234|0)[0-9 \-]{9,13}', '<PHONE>', 'g'),
      '[^ ]+@[^ ]+', '<EMAIL>', 'g'), '\s+', ' ', 'g') as msg, m.created_at
  from ai_messages m join ai_conversations c on c.id = m.conversation_id
  where m.role = 'user' and m.created_at > now() - interval '60 days' and length(trim(m.message)) between 2 and 160)
select channel, msg, count(*) as times from masked group by channel, msg order by times desc limit 400;
```
Review the result by eye before adding anything: drop names, account / meter / smartcard numbers and IDs.

## Updating the snapshot (only when a routing change is intended)
`UPDATE_SNAPSHOT=1 deno test --no-check --allow-read --allow-write --allow-env --import-map=supabase/functions/bindawasub-ai/tests/harness/import_map.json supabase/functions/bindawasub-ai/tests/replay_test.ts`
