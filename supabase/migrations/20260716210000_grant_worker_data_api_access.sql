begin;

-- Supabase projects created after May 30, 2026 no longer expose new tables
-- to the Data API automatically. The Render worker authenticates as
-- service_role, so its grants must be explicit (RLS remains bypassed only for
-- this server-side role).
grant select, insert, update, delete on table
  public.datasets,
  public.leads,
  public.sources,
  public.enrichment_jobs,
  public.enrichment_cache
to service_role;

commit;
