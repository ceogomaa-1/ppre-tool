begin;

create or replace function public.delete_lead(p_lead_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_dataset_id uuid;
  v_user_id uuid;
  v_total integer;
  v_completed integer;
  v_failed integer;
  v_matched integer;
begin
  select dataset_id, user_id
    into v_dataset_id, v_user_id
  from public.leads
  where id = p_lead_id
    and user_id = (select auth.uid())
  for update;

  if not found then
    raise exception 'Record not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.enrichment_jobs
    where dataset_id = v_dataset_id
      and user_id = v_user_id
      and status = 'running'
  ) then
    raise exception 'Pause enrichment before deleting a record' using errcode = '55000';
  end if;

  delete from public.leads
  where id = p_lead_id
    and user_id = v_user_id;

  select
    count(*)::integer,
    count(*) filter (where status in ('verified', 'needs_review', 'not_found'))::integer,
    count(*) filter (where status = 'failed')::integer,
    count(*) filter (where status = 'verified')::integer
  into v_total, v_completed, v_failed, v_matched
  from public.leads
  where dataset_id = v_dataset_id
    and user_id = v_user_id;

  update public.datasets
  set row_count = v_total,
      processed_count = v_completed + v_failed,
      matched_count = v_matched,
      failed_count = v_failed,
      updated_at = now()
  where id = v_dataset_id
    and user_id = v_user_id;

  update public.enrichment_jobs
  set rows_total = v_total,
      rows_completed = v_completed,
      rows_failed = v_failed,
      updated_at = now()
  where dataset_id = v_dataset_id
    and user_id = v_user_id;
end;
$$;

revoke all on function public.delete_lead(uuid) from public, anon;
grant execute on function public.delete_lead(uuid) to authenticated, service_role;

commit;
