-- FeasiServe Stage 2: investigation infrastructure.
-- All access is server-side with the service-role key; RLS is on with no policies,
-- so anon/authenticated clients can read or write nothing.

create or replace function set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table investigations (
  id               uuid primary key default gen_random_uuid(),
  brand            text not null check (char_length(brand) between 1 and 60),
  product_category text not null check (char_length(product_category) between 1 and 60),
  product_model    text check (product_model is null or char_length(product_model) between 1 and 60),
  pincode          text not null check (pincode ~ '^[1-9][0-9]{5}$'),
  status           text not null default 'pending'
                   check (status in ('pending', 'running', 'completed', 'partial', 'failed')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  completed_at     timestamptz,
  error_summary    text
);
-- duplicate-submission lookup
create index investigations_lookup_idx
  on investigations (brand, product_category, pincode, created_at desc);

create table investigation_runs (
  id               uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references investigations (id) on delete cascade,
  provider         text not null check (provider in ('tinyfish')),
  operation        text not null
                   check (operation in ('search_official', 'search_community', 'fetch_official', 'locator_agent')),
  external_run_id  text,
  status           text not null default 'pending'
                   check (status in ('pending', 'running', 'succeeded', 'failed', 'skipped', 'timed_out')),
  started_at       timestamptz,
  completed_at     timestamptz,
  error_message    text,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- one run per operation per investigation: repeated polls can never create a second one
  unique (investigation_id, operation)
);
create unique index investigation_runs_external_idx
  on investigation_runs (external_run_id) where external_run_id is not null;

create table evidence_sources (
  id               uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references investigations (id) on delete cascade,
  source_url       text not null,
  canonical_url    text not null,
  domain           text not null,
  source_type      text not null
                   check (source_type in ('official_manufacturer', 'manufacturer_linked', 'community', 'third_party', 'unknown')),
  retrieval_method text not null
                   check (retrieval_method in ('tinyfish_search', 'tinyfish_fetch', 'tinyfish_agent')),
  retrieved_at     timestamptz not null,
  published_at     timestamptz,
  retrieval_status text not null check (retrieval_status in ('retrieved', 'failed')),
  title            text,
  content          text,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  unique (investigation_id, retrieval_method, canonical_url)
);

create table findings (
  id                  uuid primary key default gen_random_uuid(),
  investigation_id    uuid not null references investigations (id) on delete cascade,
  evidence_source_id  uuid not null references evidence_sources (id) on delete cascade,
  finding_type        text not null check (finding_type in ('locator_result', 'service_center')),
  claim               text not null,
  extracted_value     jsonb not null default '{}'::jsonb,
  verification_status text not null
                      check (verification_status in ('VERIFIED', 'PARTIALLY_VERIFIED', 'UNVERIFIED', 'FAILED')),
  confidence          numeric(4, 3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);
create index findings_investigation_idx on findings (investigation_id);
create index findings_evidence_idx on findings (evidence_source_id);

create trigger investigations_updated_at before update on investigations
  for each row execute function set_updated_at();
create trigger investigation_runs_updated_at before update on investigation_runs
  for each row execute function set_updated_at();

alter table investigations enable row level security;
alter table investigation_runs enable row level security;
alter table evidence_sources enable row level security;
alter table findings enable row level security;
