begin;

create or replace function public.delete_leads_bulk(
  p_scope text,
  p_lead_ids uuid[] default array[]::uuid[]
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_dataset_ids uuid[];
  v_deleted integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_scope not in ('selected', 'queued', 'needs_review', 'all') then
    raise exception 'Unsupported delete scope' using errcode = '22023';
  end if;

  select array_agg(distinct dataset_id)
    into v_dataset_ids
  from public.leads
  where user_id = v_user_id
    and case p_scope
      when 'selected' then id = any(coalesce(p_lead_ids, array[]::uuid[]))
      when 'queued' then status = 'queued'
      when 'needs_review' then status = 'needs_review'
      when 'all' then true
      else false
    end;

  if coalesce(array_length(v_dataset_ids, 1), 0) = 0 then
    return 0;
  end if;

  if exists (
    select 1
    from public.enrichment_jobs
    where user_id = v_user_id
      and dataset_id = any(v_dataset_ids)
      and status = 'running'
  ) then
    raise exception 'Pause enrichment before bulk deletion' using errcode = '55000';
  end if;

  delete from public.leads
  where user_id = v_user_id
    and case p_scope
      when 'selected' then id = any(coalesce(p_lead_ids, array[]::uuid[]))
      when 'queued' then status = 'queued'
      when 'needs_review' then status = 'needs_review'
      when 'all' then true
      else false
    end;
  get diagnostics v_deleted = row_count;

  update public.datasets as dataset
  set row_count = stats.total,
      processed_count = stats.completed + stats.failed,
      matched_count = stats.matched,
      failed_count = stats.failed,
      updated_at = now()
  from (
    select selected_dataset.id,
      count(lead.id)::integer as total,
      count(lead.id) filter (where lead.status in ('verified', 'needs_review', 'not_found'))::integer as completed,
      count(lead.id) filter (where lead.status = 'failed')::integer as failed,
      count(lead.id) filter (where lead.status = 'verified')::integer as matched
    from unnest(v_dataset_ids) as selected_dataset(id)
    left join public.leads as lead
      on lead.dataset_id = selected_dataset.id
     and lead.user_id = v_user_id
    group by selected_dataset.id
  ) as stats
  where dataset.id = stats.id
    and dataset.user_id = v_user_id;

  update public.enrichment_jobs as job
  set rows_total = stats.total,
      rows_completed = stats.completed,
      rows_failed = stats.failed,
      updated_at = now()
  from (
    select selected_dataset.id,
      count(lead.id)::integer as total,
      count(lead.id) filter (where lead.status in ('verified', 'needs_review', 'not_found'))::integer as completed,
      count(lead.id) filter (where lead.status = 'failed')::integer as failed
    from unnest(v_dataset_ids) as selected_dataset(id)
    left join public.leads as lead
      on lead.dataset_id = selected_dataset.id
     and lead.user_id = v_user_id
    group by selected_dataset.id
  ) as stats
  where job.dataset_id = stats.id
    and job.user_id = v_user_id;

  return v_deleted;
end;
$$;

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
      additional_emails = array[]::text[],
      additional_phones = array[]::text[],
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

revoke all on function public.delete_leads_bulk(text, uuid[]) from public, anon;
revoke all on function public.create_lead_redo_job(uuid, numeric) from public, anon;
grant execute on function public.delete_leads_bulk(text, uuid[]) to authenticated, service_role;
grant execute on function public.create_lead_redo_job(uuid, numeric) to authenticated, service_role;

commit;
