begin;

drop policy if exists "leads_insert_own" on public.leads;
drop policy if exists "leads_update_own" on public.leads;
create policy "leads_insert_own" on public.leads for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.datasets
    where datasets.id = leads.dataset_id
      and datasets.user_id = (select auth.uid())
  )
);
create policy "leads_update_own" on public.leads for update to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.datasets
    where datasets.id = leads.dataset_id
      and datasets.user_id = (select auth.uid())
  )
);

drop policy if exists "sources_insert_own" on public.sources;
drop policy if exists "sources_update_own" on public.sources;
create policy "sources_insert_own" on public.sources for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.leads
    where leads.id = sources.lead_id
      and leads.user_id = (select auth.uid())
  )
);
create policy "sources_update_own" on public.sources for update to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.leads
    where leads.id = sources.lead_id
      and leads.user_id = (select auth.uid())
  )
);

drop policy if exists "jobs_insert_own" on public.enrichment_jobs;
drop policy if exists "jobs_update_own" on public.enrichment_jobs;
create policy "jobs_insert_own" on public.enrichment_jobs for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.datasets
    where datasets.id = enrichment_jobs.dataset_id
      and datasets.user_id = (select auth.uid())
  )
);
create policy "jobs_update_own" on public.enrichment_jobs for update to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.datasets
    where datasets.id = enrichment_jobs.dataset_id
      and datasets.user_id = (select auth.uid())
  )
);

commit;
