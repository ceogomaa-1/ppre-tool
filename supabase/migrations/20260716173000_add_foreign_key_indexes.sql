create index if not exists enrichment_jobs_dataset_idx on public.enrichment_jobs (dataset_id);
create index if not exists enrichment_jobs_user_idx on public.enrichment_jobs (user_id);
create index if not exists sources_user_idx on public.sources (user_id);
