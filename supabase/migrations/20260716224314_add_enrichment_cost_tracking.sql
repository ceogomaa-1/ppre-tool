begin;

alter table public.enrichment_jobs
  add column if not exists web_search_calls bigint not null default 0
    check (web_search_calls >= 0),
  add column if not exists cost_estimate_complete boolean not null default false,
  add column if not exists cost_limit_usd numeric(12,6)
    check (cost_limit_usd > 0);

comment on column public.enrichment_jobs.web_search_calls is
  'Count of billable OpenAI web_search_call output items observed by the worker.';
comment on column public.enrichment_jobs.cost_estimate_complete is
  'True only when estimated_cost_usd includes both model tokens and tracked web-search fees.';
comment on column public.enrichment_jobs.cost_limit_usd is
  'User-selected spending guardrail. The worker reserves budget before each record.';

-- Historical enrichment used permissive extraction and did not track paid search calls.
-- Quarantine its derived contacts rather than continuing to present them as verified.
update public.leads
set email = null,
    phone = null,
    additional_emails = '[]'::jsonb,
    additional_phones = '[]'::jsonb,
    confidence = 0,
    status = 'not_found',
    enrichment_summary = 'Legacy contact result quarantined after verification rules were tightened. Start a new enrichment to re-check this record.',
    updated_at = now()
where enriched_at is not null
  and status in ('verified', 'needs_review', 'not_found');

update public.sources
set evidence = (evidence - 'emails' - 'phones' - 'confidence')
      || jsonb_build_object('legacy_contacts_quarantined', true),
    snippet = case
      when left(ltrim(coalesce(snippet, '')), 5) = '%PDF-'
        then 'PDF retained as identity evidence; legacy contact extraction quarantined.'
      else snippet
    end;

delete from public.enrichment_cache;

update public.datasets d
set processed_count = counts.processed_count,
    matched_count = counts.matched_count,
    failed_count = counts.failed_count,
    updated_at = now()
from (
  select dataset_id,
         count(*) filter (where status in ('verified', 'needs_review', 'not_found'))::integer as processed_count,
         count(*) filter (where status = 'verified')::integer as matched_count,
         count(*) filter (where status = 'failed')::integer as failed_count
  from public.leads
  group by dataset_id
) counts
where d.id = counts.dataset_id;

commit;
