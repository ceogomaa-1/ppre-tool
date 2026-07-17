begin;

create or replace function public.create_lead_redo_job(
  p_lead_id uuid,
  p_cost_limit_usd numeric default 0.25
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_dataset_id uuid;
  v_job_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select dataset_id
    into v_dataset_id
  from public.leads
  where id = p_lead_id
    and user_id = v_user_id
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
    raise exception 'Pause active enrichment before redoing this record' using errcode = '55000';
  end if;

  delete from public.sources
  where lead_id = p_lead_id
    and user_id = v_user_id;

  update public.leads
  set email = null,
      phone = null,
      additional_emails = '[]'::jsonb,
      additional_phones = '[]'::jsonb,
      confidence = 0,
      status = 'queued',
      review_state = 'unreviewed',
      enrichment_summary = null,
      enriched_at = null,
      last_error = null,
      updated_at = now()
  where id = p_lead_id
    and user_id = v_user_id;

  insert into public.enrichment_jobs (
    dataset_id,
    user_id,
    status,
    model,
    rows_total,
    rows_completed,
    rows_failed,
    web_search_calls,
    cost_estimate_complete,
    cost_limit_usd,
    configuration
  )
  values (
    v_dataset_id,
    v_user_id,
    'queued',
    'gpt-4o-mini',
    1,
    0,
    0,
    0,
    true,
    least(2.00, greatest(0.25, coalesce(p_cost_limit_usd, 0.25))),
    jsonb_build_object(
      'max_records', 1,
      'source_limit', 3,
      'public_web_only', true,
      'verification_version', 2,
      'force_refresh', true,
      'target_lead_ids', jsonb_build_array(p_lead_id)
    )
  )
  returning id into v_job_id;

  update public.datasets
  set status = 'queued',
      processed_count = (
        select count(*)::integer
        from public.leads
        where dataset_id = v_dataset_id
          and user_id = v_user_id
          and status in ('verified', 'needs_review', 'not_found', 'failed')
      ),
      matched_count = (
        select count(*)::integer
        from public.leads
        where dataset_id = v_dataset_id
          and user_id = v_user_id
          and status = 'verified'
      ),
      failed_count = (
        select count(*)::integer
        from public.leads
        where dataset_id = v_dataset_id
          and user_id = v_user_id
          and status = 'failed'
      ),
      updated_at = now()
  where id = v_dataset_id
    and user_id = v_user_id;

  return v_job_id;
end;
$$;

revoke all on function public.create_lead_redo_job(uuid, numeric) from public, anon;
grant execute on function public.create_lead_redo_job(uuid, numeric) to authenticated, service_role;

commit;
