begin;

create extension if not exists pgcrypto;

create table if not exists public.datasets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  storage_path text,
  row_count integer not null default 0 check (row_count >= 0 and row_count <= 25000),
  mapped_columns jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','queued','processing','paused','completed','failed')),
  processed_count integer not null default 0 check (processed_count >= 0),
  matched_count integer not null default 0 check (matched_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references public.datasets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  row_number integer not null check (row_number > 0),
  owner_name text not null,
  property_address text,
  city text,
  province text,
  postal_code text,
  property_type text,
  email text,
  phone text,
  additional_emails jsonb not null default '[]'::jsonb,
  additional_phones jsonb not null default '[]'::jsonb,
  confidence numeric(5,2) not null default 0 check (confidence >= 0 and confidence <= 100),
  status text not null default 'queued' check (status in ('queued','researching','verified','needs_review','not_found','failed')),
  review_state text not null default 'unreviewed' check (review_state in ('unreviewed','approved','rejected')),
  raw_data jsonb not null default '{}'::jsonb,
  enrichment_summary text,
  last_error text,
  enriched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dataset_id, row_number)
);

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_url text not null,
  source_domain text not null,
  source_type text not null default 'web',
  title text,
  snippet text,
  evidence jsonb not null default '{}'::jsonb,
  content_hash text,
  captured_at timestamptz not null default now(),
  unique (lead_id, source_url)
);

create table if not exists public.enrichment_jobs (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references public.datasets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','running','paused','completed','failed','cancelled')),
  model text not null default 'gpt-5.6-luna',
  rows_total integer not null default 0 check (rows_total >= 0),
  rows_completed integer not null default 0 check (rows_completed >= 0),
  rows_failed integer not null default 0 check (rows_failed >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  estimated_cost_usd numeric(12,6) not null default 0 check (estimated_cost_usd >= 0),
  configuration jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.enrichment_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fingerprint text not null,
  result jsonb not null,
  source_urls jsonb not null default '[]'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (user_id, fingerprint)
);

create index if not exists datasets_user_created_idx on public.datasets (user_id, created_at desc);
create index if not exists leads_dataset_status_idx on public.leads (dataset_id, status);
create index if not exists leads_user_owner_idx on public.leads (user_id, owner_name);
create index if not exists sources_lead_idx on public.sources (lead_id, captured_at desc);
create index if not exists jobs_status_created_idx on public.enrichment_jobs (status, created_at);
create index if not exists cache_fingerprint_expiry_idx on public.enrichment_cache (fingerprint, expires_at);

alter table public.datasets enable row level security;
alter table public.leads enable row level security;
alter table public.sources enable row level security;
alter table public.enrichment_jobs enable row level security;
alter table public.enrichment_cache enable row level security;

drop policy if exists "datasets_select_own" on public.datasets;
drop policy if exists "datasets_insert_own" on public.datasets;
drop policy if exists "datasets_update_own" on public.datasets;
drop policy if exists "datasets_delete_own" on public.datasets;
create policy "datasets_select_own" on public.datasets for select to authenticated using ((select auth.uid()) = user_id);
create policy "datasets_insert_own" on public.datasets for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "datasets_update_own" on public.datasets for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "datasets_delete_own" on public.datasets for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "leads_select_own" on public.leads;
drop policy if exists "leads_insert_own" on public.leads;
drop policy if exists "leads_update_own" on public.leads;
drop policy if exists "leads_delete_own" on public.leads;
create policy "leads_select_own" on public.leads for select to authenticated using ((select auth.uid()) = user_id);
create policy "leads_insert_own" on public.leads for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "leads_update_own" on public.leads for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "leads_delete_own" on public.leads for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "sources_select_own" on public.sources;
drop policy if exists "sources_insert_own" on public.sources;
drop policy if exists "sources_update_own" on public.sources;
drop policy if exists "sources_delete_own" on public.sources;
create policy "sources_select_own" on public.sources for select to authenticated using ((select auth.uid()) = user_id);
create policy "sources_insert_own" on public.sources for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "sources_update_own" on public.sources for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "sources_delete_own" on public.sources for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "jobs_select_own" on public.enrichment_jobs;
drop policy if exists "jobs_insert_own" on public.enrichment_jobs;
drop policy if exists "jobs_update_own" on public.enrichment_jobs;
drop policy if exists "jobs_delete_own" on public.enrichment_jobs;
create policy "jobs_select_own" on public.enrichment_jobs for select to authenticated using ((select auth.uid()) = user_id);
create policy "jobs_insert_own" on public.enrichment_jobs for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "jobs_update_own" on public.enrichment_jobs for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "jobs_delete_own" on public.enrichment_jobs for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "cache_select_own" on public.enrichment_cache;
drop policy if exists "cache_insert_own" on public.enrichment_cache;
drop policy if exists "cache_update_own" on public.enrichment_cache;
drop policy if exists "cache_delete_own" on public.enrichment_cache;
create policy "cache_select_own" on public.enrichment_cache for select to authenticated using ((select auth.uid()) = user_id);
create policy "cache_insert_own" on public.enrichment_cache for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "cache_update_own" on public.enrichment_cache for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "cache_delete_own" on public.enrichment_cache for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.datasets, public.leads, public.sources, public.enrichment_jobs, public.enrichment_cache from anon;
grant select, insert, update, delete on public.datasets, public.leads, public.sources, public.enrichment_jobs, public.enrichment_cache to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'imports',
  'imports',
  false,
  26214400,
  array[
    'text/csv',
    'text/tab-separated-values',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "imports_select_own" on storage.objects;
drop policy if exists "imports_insert_own" on storage.objects;
drop policy if exists "imports_update_own" on storage.objects;
drop policy if exists "imports_delete_own" on storage.objects;
create policy "imports_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'imports' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "imports_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'imports' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "imports_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'imports' and (storage.foldername(name))[1] = (select auth.uid()::text))
  with check (bucket_id = 'imports' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "imports_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'imports' and (storage.foldername(name))[1] = (select auth.uid()::text));

commit;
