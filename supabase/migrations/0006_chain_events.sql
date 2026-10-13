-- On-chain usage, read from the chain instead of reported by clients. `activity` only sees
-- what the web app logs, so payments an agent makes through eunomia-mcp never reached it —
-- the product's value moment was unmeasured. The chain-indexer Worker (workers/chain-indexer)
-- pages Stellar RPC events on a cron and writes them here. The RPC keeps ~7 days of events,
-- so the cursor table lets each run pick up exactly where the last one stopped.
-- No anon policies: only the Worker's service-role key writes, and nothing is public.

create table if not exists public.chain_treasuries (
  network text not null,
  treasury_id text not null check (treasury_id ~ '^C[A-Z2-7]{55}$'),
  owner text,
  registered_at timestamptz,
  primary key (network, treasury_id)
);

create table if not exists public.chain_events (
  id text not null,                 -- RPC event id: unique per network
  network text not null,
  ledger integer not null,
  closed_at timestamptz not null,
  tx_hash text not null,
  contract_id text not null,
  kind text not null,               -- topic symbol: paid / session / revoked / escrowed / …
  counterparty text,                -- payee, agent or withdrawal target, when the event names one
  amount numeric,                   -- raw token units (7 decimals), when the event carries one
  primary key (network, id)
);

create index if not exists chain_events_kind_time on public.chain_events (network, kind, closed_at);
create index if not exists chain_events_contract on public.chain_events (network, contract_id);

create table if not exists public.chain_cursor (
  network text primary key,
  cursor text,
  last_ledger integer,
  updated_at timestamptz not null default now()
);

alter table public.chain_treasuries enable row level security;
alter table public.chain_events enable row level security;
alter table public.chain_cursor enable row level security;

-- Treasuries registered before the RPC's retention window are only known from the app's
-- own log; seed them so their later events are still recognised.
insert into public.chain_treasuries (network, treasury_id)
select distinct 'testnet', treasury_id
from public.activity
where treasury_id ~ '^C[A-Z2-7]{55}$'
on conflict do nothing;

-- Weekly product metrics. "repeat_treasuries" = treasuries that had payments on two or more
-- distinct days up to and including that week — the value event the CDP is testing.
create or replace view public.chain_weekly
with (security_invoker = true) as
with paid as (
  select network, contract_id, closed_at, (closed_at at time zone 'utc')::date as day
  from public.chain_events
  where kind = 'paid'
),
weeks as (
  select distinct network, date_trunc('week', closed_at) as week from public.chain_events
)
select
  w.network,
  w.week::date as week,
  (select count(*) from public.chain_treasuries t
     where t.network = w.network and date_trunc('week', t.registered_at) = w.week) as new_treasuries,
  (select count(*) from public.chain_events e
     where e.network = w.network and e.kind = 'session' and date_trunc('week', e.closed_at) = w.week) as sessions,
  (select count(*) from paid p
     where p.network = w.network and date_trunc('week', p.closed_at) = w.week) as payments,
  (select count(distinct p.contract_id) from paid p
     where p.network = w.network and date_trunc('week', p.closed_at) = w.week) as paying_treasuries,
  (select count(*) from (
     select p.contract_id from paid p
     where p.network = w.network and p.closed_at < w.week + interval '7 days'
     group by p.contract_id having count(distinct p.day) >= 2) r) as repeat_treasuries
from weeks w
order by w.network, w.week;
