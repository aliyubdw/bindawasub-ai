alter table public.transactions
  add column if not exists customer_notified_at timestamptz;

alter table public.transactions
  add column if not exists notification_attempts integer not null default 0;

alter table public.transactions
  add column if not exists last_notification_error text;

alter table public.transactions
  add column if not exists notification_claimed_at timestamptz;

create index if not exists transactions_notification_retry_idx
  on public.transactions (status, customer_notified_at, notification_attempts, completed_at)
  where status in ('successful','failed','reversed')
    and customer_notified_at is null;

create index if not exists transactions_notification_claim_idx
  on public.transactions (notification_claimed_at)
  where status in ('successful','failed','reversed')
    and customer_notified_at is null;