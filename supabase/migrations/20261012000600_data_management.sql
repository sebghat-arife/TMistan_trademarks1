-- =============================================================================
-- 0600 — Admin Data Management, import provenance, official Excel columns,
--        public-API hardening.  ADDITIVE: no table is dropped, no row deleted.
--
-- Apply with the Supabase SQL editor (supabase/APPLY_0600.sql) — nothing in
-- the web app executes schema changes.
--
--  1. trademarks.registration_number / application_number (columns 13–14 of
--     the official Excel structure) + created_by_job_id provenance columns.
--  2. Import functions: job must be running (server-side cancel), new
--     columns, creation provenance, per-row items for inserted/updated rows.
--  3. admin_actions (operation-level audit log) + immutable audit tables.
--  4. storage_cleanup_queue — Storage objects to remove after a DB deletion,
--     with retry; nothing is reported "deleted" that still exists.
--  5. Admin read functions for the Data Management Center.
--  6. Admin mutations: archive/restore, delete trademarks, delete images,
--     delete-by-import-batch, cancel job, delete job record, purge old jobs.
--  7. Public API hardening: anon/authenticated may only read public columns of
--     trademarks / trademark_images; attorney_or_representative and review
--     fields leave the public search result type.
-- =============================================================================
-- (transaction wrapper added by supabase/APPLY_0600.sql / APPLY_ALL.sql)

-- -----------------------------------------------------------------------------
-- 1. Columns
-- -----------------------------------------------------------------------------
alter table public.trademarks
  add column if not exists registration_number text,
  add column if not exists application_number  text,
  add column if not exists created_by_job_id   uuid;

alter table public.trademark_images
  add column if not exists created_by_job_id   uuid;

comment on column public.trademarks.registration_number is 'Column 13 ("Registration Number") of the official Excel structure, stored verbatim.';
comment on column public.trademarks.application_number  is 'Column 14 ("Application Number") of the official Excel structure, stored verbatim.';
comment on column public.trademarks.created_by_job_id   is 'Import job that CREATED the row (never overwritten). import_job_id = last job that touched it.';
comment on column public.trademark_images.created_by_job_id is 'Import job that CREATED the row (never overwritten).';

-- Backfill creation provenance from the row-level audit log (INSERT entries
-- carry the import_job_id the row was created with). Rows without such an
-- entry (pre-audit baseline data) keep NULL and are never batch-deletable.
update public.trademarks t
   set created_by_job_id = (a.new_data ->> 'import_job_id')::uuid
  from public.audit_logs a
 where t.created_by_job_id is null
   and a.table_name = 'trademarks' and a.action = 'INSERT'
   and a.row_id = t.id::text
   and coalesce(a.new_data ->> 'import_job_id', '') ~* '^[0-9a-f-]{36}$';

update public.trademark_images i
   set created_by_job_id = (a.new_data ->> 'import_job_id')::uuid
  from public.audit_logs a
 where i.created_by_job_id is null
   and a.table_name = 'trademark_images' and a.action = 'INSERT'
   and a.row_id = i.id::text
   and coalesce(a.new_data ->> 'import_job_id', '') ~* '^[0-9a-f-]{36}$';

create index if not exists trademarks_created_by_job_idx
  on public.trademarks (created_by_job_id) where created_by_job_id is not null;
create index if not exists trademarks_import_job_idx
  on public.trademarks (import_job_id) where import_job_id is not null;
create index if not exists trademark_images_created_by_job_idx
  on public.trademark_images (created_by_job_id) where created_by_job_id is not null;
create index if not exists trademark_images_import_job_idx
  on public.trademark_images (import_job_id) where import_job_id is not null;
create index if not exists trademarks_registration_number_idx
  on public.trademarks (registration_number) where registration_number is not null;
create index if not exists trademarks_application_number_idx
  on public.trademarks (application_number) where application_number is not null;

-- -----------------------------------------------------------------------------
-- 2a. admin_import_trademark_rows — 21-column structure, provenance, cancel
-- -----------------------------------------------------------------------------
create or replace function public.admin_import_trademark_rows(p_job_id uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c_cols constant text[] := array[
    'record_number','serial_number','mark_name','mark_print','applicant_name','applicant_address',
    'trademark_class','goods_and_services','application_type','attorney_or_representative',
    'publication_date','objection_deadline','official_gazette_number','registration_number',
    'application_number','new_address','old_address','new_owner','old_owner','source_page',
    'review_note','source_file','source_sheet','source_row'];
  r         jsonb;
  k         text;
  v_in      jsonb;
  v_serial  text;
  v_gazette text;
  v_status  text;
  v_old     public.trademarks;
  v_merged  public.trademarks;
  v_id      uuid;
  v_changed text[];
  n_ins int := 0;
  n_upd int := 0;
  n_skip int := 0;
  n_fail int := 0;
  v_results jsonb := '[]'::jsonb;
  v_items   jsonb := '[]'::jsonb;
begin
  perform public.admin_assert();
  select status into v_status from public.import_jobs where id = p_job_id;
  if v_status is null then
    raise exception 'Unknown import job %', p_job_id using errcode = '22023';
  end if;
  if v_status not in ('queued', 'processing') then
    raise exception 'Import job % is % — no further rows are accepted (cancelled or finished)', p_job_id, v_status
      using errcode = '55000';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 1000 then
    raise exception 'At most 1000 rows per call' using errcode = '22023';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    v_serial := null; v_id := null; v_changed := '{}';
    begin
      -- whitelist + trim; empty strings become NULL; nothing else is accepted
      v_in := '{}'::jsonb;
      foreach k in array c_cols loop
        if r ? k then
          v_in := v_in || jsonb_build_object(k,
                    case when jsonb_typeof(r -> k) = 'null' then null
                         else nullif(btrim(r ->> k), '') end);
        end if;
      end loop;
      v_serial := v_in ->> 'serial_number';
      if v_serial is null then
        raise exception 'serial_number is empty' using errcode = '23502';
      end if;
      v_gazette := coalesce(v_in ->> 'official_gazette_number', (regexp_match(v_serial, '^\D*(\d+)\D'))[1]);
      if v_gazette is null then
        raise exception 'official_gazette_number is missing and cannot be derived from serial "%"', v_serial
          using errcode = '23502';
      end if;
      v_in := v_in || jsonb_build_object('serial_number', v_serial, 'official_gazette_number', v_gazette);

      select * into v_old from public.trademarks t where t.serial_number = v_serial order by t.created_at limit 1;
      if found then
        v_merged := jsonb_populate_record(v_old, v_in);
        select coalesce(array_agg(c), '{}') into v_changed
          from unnest(c_cols) c
         where c <> 'serial_number'
           and (to_jsonb(v_merged) -> c) is distinct from (to_jsonb(v_old) -> c);
        if coalesce(array_length(v_changed, 1), 0) = 0 then
          n_skip := n_skip + 1;
        else
          update public.trademarks t set
            record_number              = v_merged.record_number,
            mark_name                  = v_merged.mark_name,
            mark_print                 = v_merged.mark_print,
            applicant_name             = v_merged.applicant_name,
            applicant_address          = v_merged.applicant_address,
            trademark_class            = v_merged.trademark_class,
            goods_and_services         = v_merged.goods_and_services,
            application_type           = v_merged.application_type,
            attorney_or_representative = v_merged.attorney_or_representative,
            publication_date           = v_merged.publication_date,
            objection_deadline         = v_merged.objection_deadline,
            official_gazette_number    = v_merged.official_gazette_number,
            registration_number        = v_merged.registration_number,
            application_number         = v_merged.application_number,
            new_address                = v_merged.new_address,
            old_address                = v_merged.old_address,
            new_owner                  = v_merged.new_owner,
            old_owner                  = v_merged.old_owner,
            source_page                = v_merged.source_page,
            review_note                = v_merged.review_note,
            source_file                = v_merged.source_file,
            source_sheet               = v_merged.source_sheet,
            source_row                 = v_merged.source_row,
            import_job_id              = p_job_id
          where t.id = v_old.id;
          n_upd := n_upd + 1;
          v_items := v_items || jsonb_build_object('item_ref', v_serial, 'status', 'updated',
                       'trademark_id', v_old.id, 'serial', v_serial, 'source_row', r -> 'source_row',
                       'changed', to_jsonb(v_changed));
        end if;
      else
        v_merged := jsonb_populate_record(null::public.trademarks, v_in);
        insert into public.trademarks (
          record_number, serial_number, mark_name, mark_print, applicant_name, applicant_address,
          trademark_class, goods_and_services, application_type, attorney_or_representative,
          publication_date, objection_deadline, official_gazette_number, registration_number,
          application_number, new_address, old_address, new_owner, old_owner, source_page,
          review_note, source_file, source_sheet, source_row, import_job_id, created_by_job_id)
        values (
          v_merged.record_number, v_merged.serial_number, v_merged.mark_name, v_merged.mark_print,
          v_merged.applicant_name, v_merged.applicant_address, v_merged.trademark_class,
          v_merged.goods_and_services, v_merged.application_type, v_merged.attorney_or_representative,
          v_merged.publication_date, v_merged.objection_deadline, v_merged.official_gazette_number,
          v_merged.registration_number, v_merged.application_number,
          v_merged.new_address, v_merged.old_address, v_merged.new_owner, v_merged.old_owner,
          v_merged.source_page, v_merged.review_note, v_merged.source_file, v_merged.source_sheet,
          v_merged.source_row, p_job_id, p_job_id)
        returning id into v_id;
        n_ins := n_ins + 1;
        v_items := v_items || jsonb_build_object('item_ref', v_serial, 'status', 'inserted',
                     'trademark_id', v_id, 'serial', v_serial, 'source_row', r -> 'source_row');
      end if;
    exception when others then
      n_fail := n_fail + 1;
      v_results := v_results || jsonb_build_object(
        'serial', v_serial, 'source_row', r -> 'source_row', 'status', 'failed',
        'message', sqlerrm, 'code', sqlstate);
    end;
  end loop;

  update public.import_jobs
     set inserted_rows = inserted_rows + n_ins,
         updated_rows  = updated_rows  + n_upd,
         skipped_rows  = skipped_rows  + n_skip,
         failed_rows   = failed_rows   + n_fail,
         started_at    = coalesce(started_at, now())
   where id = p_job_id;

  -- provenance: one item per inserted/updated row (which record, which import)
  if jsonb_array_length(v_items) > 0 then
    insert into public.import_job_items (job_id, item_ref, status, message, payload)
    select p_job_id, x ->> 'item_ref', x ->> 'status', null, (x - 'item_ref' - 'status')
      from jsonb_array_elements(v_items) x;
  end if;
  if n_fail > 0 then
    insert into public.import_job_items (job_id, item_ref, status, message, payload)
    select p_job_id,
           coalesce(x ->> 'serial', 'row ' || coalesce(x ->> 'source_row', '?')),
           'failed', x ->> 'message', x
      from jsonb_array_elements(v_results) x;
  end if;
  return jsonb_build_object('inserted', n_ins, 'updated', n_upd, 'skipped', n_skip, 'failed', n_fail, 'results', v_results);
end $$;

-- -----------------------------------------------------------------------------
-- 2b. admin_register_images — creation provenance + server-side cancel
-- -----------------------------------------------------------------------------
create or replace function public.admin_register_images(p_job_id uuid, p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  x          jsonb;
  v_tm       uuid;
  v_path     text;
  v_bucket   text;
  v_hash     text;
  v_type     text;
  v_job      text;
  v_existing public.trademark_images;
  v_replaced text[];
  n_ins int := 0;
  n_upd int := 0;
  n_unch int := 0;
  n_fail int := 0;
  v_results  jsonb := '[]'::jsonb;
  v_status   text;
begin
  perform public.admin_assert();
  select status into v_job from public.import_jobs where id = p_job_id;
  if v_job is null then
    raise exception 'Unknown import job %', p_job_id using errcode = '22023';
  end if;
  if v_job not in ('queued', 'processing') then
    raise exception 'Import job % is % — no further images are accepted (cancelled or finished)', p_job_id, v_job
      using errcode = '55000';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'At most 500 images per call' using errcode = '22023';
  end if;

  for x in select value from jsonb_array_elements(p_items) loop
    v_replaced := '{}';
    begin
      v_tm     := (x ->> 'trademark_id')::uuid;
      v_bucket := coalesce(nullif(x ->> 'storage_bucket', ''), 'trademark-images');
      if v_bucket <> 'trademark-images' then
        raise exception 'Images must live in the public bucket trademark-images (got %)', v_bucket using errcode = '22023';
      end if;
      v_path   := nullif(btrim(x ->> 'storage_path'), '');
      if v_path ~ '(^|/)\.\.(/|$)' or v_path like '/%' then
        raise exception 'Invalid storage path %', v_path using errcode = '22023';
      end if;
      v_hash   := nullif(x ->> 'content_hash', '');
      v_type   := coalesce(nullif(x ->> 'image_type', ''), 'logo');
      if v_tm is null or v_path is null then
        raise exception 'trademark_id and storage_path are required' using errcode = '23502';
      end if;
      if not exists (select 1 from public.trademarks t where t.id = v_tm) then
        raise exception 'Trademark % does not exist', v_tm using errcode = '23503';
      end if;

      select * into v_existing from public.trademark_images i
       where i.storage_bucket = v_bucket and i.storage_path = v_path;

      if found and v_existing.trademark_id = v_tm and v_existing.status = 'matched'
         and v_existing.content_hash is not distinct from v_hash then
        n_unch := n_unch + 1;
        v_status := 'unchanged';
        update public.trademark_images set
          thumbnail_path = coalesce(nullif(x ->> 'thumbnail_path', ''), thumbnail_path),
          width = coalesce((x ->> 'width')::int, width), height = coalesce((x ->> 'height')::int, height),
          byte_size = coalesce((x ->> 'byte_size')::bigint, byte_size),
          content_type = coalesce(nullif(x ->> 'content_type', ''), content_type),
          import_job_id = coalesce(import_job_id, p_job_id)
        where id = v_existing.id;
      else
        -- a re-import supersedes the older automatically matched image of the same type
        with gone as (
          delete from public.trademark_images i
           where i.trademark_id = v_tm and i.image_type = v_type
             and i.match_method is distinct from 'manual'
             and not (i.storage_bucket = v_bucket and i.storage_path = v_path)
          returning i.storage_path, i.thumbnail_path
        )
        select coalesce(array_agg(q.p), '{}') into v_replaced
          from (select g.storage_path as p from gone g
                union all
                select g.thumbnail_path from gone g where g.thumbnail_path is not null) q;

        insert into public.trademark_images (
          trademark_id, image_type, status, match_method, storage_bucket, storage_path, thumbnail_path,
          original_filename, source_folder, gazette_number, serial_number, width, height, byte_size,
          content_type, content_hash, sort_order, import_job_id, created_by_job_id)
        values (
          v_tm, v_type, 'matched', coalesce(nullif(x ->> 'match_method', ''), 'serial_filename'),
          v_bucket, v_path, nullif(x ->> 'thumbnail_path', ''),
          left(x ->> 'original_filename', 500), left(x ->> 'source_folder', 500),
          x ->> 'gazette_number', x ->> 'serial_number',
          (x ->> 'width')::int, (x ->> 'height')::int, (x ->> 'byte_size')::bigint,
          nullif(x ->> 'content_type', ''), v_hash, 0, p_job_id, p_job_id)
        on conflict (storage_bucket, storage_path) do update set
          trademark_id      = excluded.trademark_id,
          image_type        = excluded.image_type,
          status            = 'matched',
          match_method      = excluded.match_method,
          thumbnail_path    = excluded.thumbnail_path,
          original_filename = excluded.original_filename,
          source_folder     = excluded.source_folder,
          gazette_number    = excluded.gazette_number,
          serial_number     = excluded.serial_number,
          width             = excluded.width,
          height            = excluded.height,
          byte_size         = excluded.byte_size,
          content_type      = excluded.content_type,
          content_hash      = excluded.content_hash,
          import_job_id     = excluded.import_job_id,
          review_note       = null;          -- created_by_job_id intentionally kept

        if v_existing.id is not null or array_length(v_replaced, 1) > 0 then
          n_upd := n_upd + 1; v_status := 'updated';
        else
          n_ins := n_ins + 1; v_status := 'inserted';
        end if;
      end if;

      v_results := v_results || jsonb_build_object(
        'storage_path', v_path, 'trademark_id', v_tm, 'status', v_status,
        'replaced_paths', to_jsonb(v_replaced));
    exception when others then
      n_fail := n_fail + 1;
      v_results := v_results || jsonb_build_object(
        'storage_path', x ->> 'storage_path', 'trademark_id', x ->> 'trademark_id',
        'status', 'failed', 'message', sqlerrm, 'code', sqlstate);
    end;
    v_existing := null;
  end loop;

  update public.import_jobs
     set inserted_rows = inserted_rows + n_ins,
         updated_rows  = updated_rows  + n_upd,
         skipped_rows  = skipped_rows  + n_unch,
         failed_rows   = failed_rows   + n_fail
   where id = p_job_id;
  if n_fail > 0 then
    insert into public.import_job_items (job_id, item_ref, status, message, payload)
    select p_job_id, coalesce(e ->> 'storage_path', '?'), 'failed', e ->> 'message', e
      from jsonb_array_elements(v_results) e where e ->> 'status' = 'failed';
  end if;
  return jsonb_build_object('inserted', n_ins, 'updated', n_upd, 'unchanged', n_unch, 'failed', n_fail, 'results', v_results);
end $$;

-- -----------------------------------------------------------------------------
-- 3. Operation-level audit log (who deleted what, when, with which result).
--    Row-level before/after images stay in audit_logs (trigger-based).
--    Both tables are append-only: no UPDATE/DELETE privilege for app roles and
--    a trigger refuses modification even from the owner.
-- -----------------------------------------------------------------------------
create table if not exists public.admin_actions (
  id              bigint generated always as identity primary key,
  actor_id        uuid,
  actor_email     text,
  action          text not null,              -- trademarks.delete | trademarks.archive | images.delete | import_job.delete_records | …
  target_type     text not null,              -- trademark | image | import_job | storage_object | mixed
  target_ids      text[] not null default '{}',
  serials         text[] not null default '{}',
  storage_paths   text[] not null default '{}',
  job_id          uuid,
  affected_count  int  not null default 0,
  status          text not null default 'success',   -- success | partial | failed | preview
  details         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  constraint admin_actions_status_check check (status in ('success', 'partial', 'failed', 'preview'))
);
comment on table public.admin_actions is
  'Append-only log of administrative data-management operations (deletions, archiving, cleanup). Never contains credentials.';
create index if not exists admin_actions_created_idx on public.admin_actions (created_at desc);
create index if not exists admin_actions_job_idx on public.admin_actions (job_id) where job_id is not null;

alter table public.admin_actions enable row level security;
drop policy if exists "admin read admin actions" on public.admin_actions;
create policy "admin read admin actions"
  on public.admin_actions for select to authenticated using (public.is_admin());
revoke all on public.admin_actions from public, anon, authenticated;
grant select on public.admin_actions to authenticated;

create or replace function public.audit_rows_are_immutable()
returns trigger
language plpgsql as $$
begin
  raise exception 'Rows of % are append-only; % is not allowed (audit trail)', tg_table_name, tg_op
    using errcode = '42501';
end $$;

drop trigger if exists admin_actions_immutable on public.admin_actions;
create trigger admin_actions_immutable
  before update or delete on public.admin_actions
  for each row execute function public.audit_rows_are_immutable();
drop trigger if exists audit_logs_immutable on public.audit_logs;
create trigger audit_logs_immutable
  before update or delete on public.audit_logs
  for each row execute function public.audit_rows_are_immutable();

-- Internal helper (not exposed): write one admin_actions row for the current user.
create or replace function public.admin_record_action(
  p_action text, p_target_type text, p_target_ids text[], p_serials text[], p_storage_paths text[],
  p_job_id uuid, p_affected int, p_status text, p_details jsonb)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id    bigint;
  v_email text;
begin
  begin
    v_email := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'email', '');
  exception when others then v_email := null; end;
  insert into public.admin_actions (actor_id, actor_email, action, target_type, target_ids, serials, storage_paths,
                                    job_id, affected_count, status, details)
  values (auth.uid(), v_email, p_action, p_target_type,
          coalesce(p_target_ids, '{}'), coalesce(p_serials, '{}'), coalesce(p_storage_paths, '{}'),
          p_job_id, coalesce(p_affected, 0), coalesce(p_status, 'success'), coalesce(p_details, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.admin_record_action(text, text, text[], text[], text[], uuid, int, text, jsonb) from public, anon, authenticated;

-- Client-callable variant for operations the browser performs directly against
-- the Storage API (orphaned object removal). Admin only.
create or replace function public.admin_log_action(p_action text, p_target_type text, p_storage_paths text[], p_status text, p_details jsonb default '{}'::jsonb)
returns bigint
language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_assert();
  if p_action !~ '^[a-z_]+\.[a-z_]+$' or length(p_action) > 60 then
    raise exception 'Invalid action name' using errcode = '22023';
  end if;
  if p_status not in ('success', 'partial', 'failed') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  return public.admin_record_action(p_action, left(coalesce(p_target_type, 'storage_object'), 40), '{}', '{}',
                                    coalesce(p_storage_paths, '{}'), null,
                                    coalesce(array_length(p_storage_paths, 1), 0), p_status,
                                    coalesce(p_details, '{}'::jsonb) - 'token' - 'key' - 'password');
end $$;

-- -----------------------------------------------------------------------------
-- 4. Storage cleanup queue: the database never pretends an object is gone.
--    DB deletions enqueue the object paths; the browser (admin session, Storage
--    RLS) removes them and reports back; failures stay visible and retryable.
-- -----------------------------------------------------------------------------
create table if not exists public.storage_cleanup_queue (
  id            bigint generated always as identity primary key,
  bucket        text not null default 'trademark-images',
  path          text not null,
  reason        text,                      -- trademarks.delete | images.delete | import_job.delete_records | import.replaced
  action_id     bigint references public.admin_actions (id) on delete set null,
  status        text not null default 'pending',   -- pending | done | failed | skipped
  attempts      int  not null default 0,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint storage_cleanup_status_check check (status in ('pending', 'done', 'failed', 'skipped'))
);
create index if not exists storage_cleanup_queue_status_idx on public.storage_cleanup_queue (status, created_at);
alter table public.storage_cleanup_queue enable row level security;
drop policy if exists "admin read storage cleanup" on public.storage_cleanup_queue;
create policy "admin read storage cleanup"
  on public.storage_cleanup_queue for select to authenticated using (public.is_admin());
revoke all on public.storage_cleanup_queue from public, anon, authenticated;
grant select on public.storage_cleanup_queue to authenticated;

-- Enqueue paths that are no longer referenced by ANY trademark_images row
-- (a shared object referenced by another valid record is never queued).
create or replace function public.admin_enqueue_storage_cleanup(p_paths text[], p_reason text, p_action_id bigint)
returns int
language plpgsql security definer set search_path = public as $$
declare
  n int := 0;
begin
  insert into public.storage_cleanup_queue (bucket, path, reason, action_id)
  select distinct 'trademark-images', p, p_reason, p_action_id
    from unnest(coalesce(p_paths, '{}')) p
   where p is not null and btrim(p) <> ''
     and not exists (select 1 from public.trademark_images i
                      where i.storage_bucket = 'trademark-images'
                        and (i.storage_path = p or i.thumbnail_path = p))
     and not exists (select 1 from public.storage_cleanup_queue q
                      where q.bucket = 'trademark-images' and q.path = p and q.status in ('pending', 'failed'));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.admin_enqueue_storage_cleanup(text[], text, bigint) from public, anon, authenticated;

create or replace function public.admin_storage_cleanup_list(p_status text default 'pending', p_limit int default 500)
returns setof public.storage_cleanup_queue
language sql security definer stable set search_path = public as $$
  select q.* from public.storage_cleanup_queue q
   where public.is_admin()
     and (p_status is null or p_status = 'all' or q.status = p_status)
   order by q.created_at
   limit least(greatest(coalesce(p_limit, 500), 1), 2000);
$$;

create or replace function public.admin_storage_cleanup_mark(p_ids bigint[], p_status text, p_error text default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  perform public.admin_assert();
  if p_status not in ('done', 'failed', 'skipped', 'pending') then
    raise exception 'status must be done, failed, skipped or pending' using errcode = '22023';
  end if;
  update public.storage_cleanup_queue
     set status     = p_status,
         attempts   = attempts + case when p_status in ('done', 'failed') then 1 else 0 end,
         last_error = case when p_status = 'failed' then left(p_error, 1000) else null end,
         updated_at = now()
   where id = any (coalesce(p_ids, '{}'));
  get diagnostics n = row_count;
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Admin read functions (SECURITY DEFINER + admin_assert; authenticated only)
-- -----------------------------------------------------------------------------
create or replace function public.admin_data_overview()
returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare
  v jsonb;
begin
  perform public.admin_assert();
  select jsonb_build_object(
    'trademarks', (select jsonb_build_object(
        'total',          count(*),
        'published',      count(*) filter (where is_published),
        'archived',       count(*) filter (where not is_published),
        'with_images',    count(*) filter (where exists (select 1 from public.trademark_images i where i.trademark_id = t.id and i.status = 'matched')),
        'without_images', count(*) filter (where not exists (select 1 from public.trademark_images i where i.trademark_id = t.id and i.status = 'matched')),
        'gazettes',       count(distinct official_gazette_number),
        'with_provenance', count(*) filter (where created_by_job_id is not null),
        'last_created_at', max(created_at),
        'last_updated_at', max(updated_at))
      from public.trademarks t),
    'images', (select jsonb_build_object(
        'total',        count(*),
        'matched',      count(*) filter (where status = 'matched'),
        'unmatched',    count(*) filter (where status = 'unmatched'),
        'ambiguous',    count(*) filter (where status = 'ambiguous'),
        'needs_review', count(*) filter (where status = 'needs_review'),
        'unlinked',     count(*) filter (where trademark_id is null),
        'bytes',        coalesce(sum(byte_size), 0),
        'indexed',      (select count(*) from public.trademark_image_features))
      from public.trademark_images),
    'import_jobs', (select jsonb_build_object(
        'total',     count(*),
        'excel',     count(*) filter (where job_type = 'excel'),
        'images',    count(*) filter (where job_type = 'images'),
        'running',   count(*) filter (where status in ('queued', 'processing')),
        'failed',    count(*) filter (where status = 'failed'),
        'warnings',  count(*) filter (where status = 'completed_with_warnings'),
        'completed', count(*) filter (where status = 'completed'),
        'last_at',   max(created_at),
        'stale_running', count(*) filter (where status in ('queued', 'processing') and created_at < now() - interval '2 hours'))
      from public.import_jobs),
    'storage_cleanup', (select jsonb_build_object(
        'pending', count(*) filter (where status = 'pending'),
        'failed',  count(*) filter (where status = 'failed'),
        'done',    count(*) filter (where status = 'done'))
      from public.storage_cleanup_queue),
    'audit', jsonb_build_object(
        'admin_actions', (select count(*) from public.admin_actions),
        'audit_logs',    (select count(*) from public.audit_logs),
        'last_action_at', (select max(created_at) from public.admin_actions)),
    'generated_at', now())
  into v;
  return v;
end $$;

create or replace function public.admin_search_trademarks(
  p_query text default null, p_gazette text default null, p_status text default 'all',
  p_job_id uuid default null, p_images text default 'all', p_sort text default 'updated',
  p_limit int default 50, p_offset int default 0)
returns table (
  id uuid, serial_number text, record_number text, mark_name text, applicant_name text,
  trademark_class text, application_type text, official_gazette_number text, publication_date date,
  registration_number text, application_number text, is_published boolean, review_status text,
  image_count int, import_job_id uuid, created_by_job_id uuid, created_at timestamptz,
  updated_at timestamptz, total_count bigint)
language plpgsql security definer stable set search_path = public, extensions as $$
declare
  q  text := nullif(btrim(p_query), '');
  nq text := public.normalize_text(p_query);
begin
  perform public.admin_assert();
  return query
  select t.id, t.serial_number, t.record_number, t.mark_name, t.applicant_name,
         t.trademark_class, t.application_type, t.official_gazette_number, t.publication_date,
         t.registration_number, t.application_number, t.is_published, t.review_status,
         (select count(*)::int from public.trademark_images i where i.trademark_id = t.id) as image_count,
         t.import_job_id, t.created_by_job_id, t.created_at, t.updated_at,
         count(*) over () as total_count
    from public.trademarks t
   where (q is null
          or t.serial_number ilike q || '%'
          or t.serial_number_normalized = public.serial_canonical(q)
          or t.mark_name_normalized like '%' || nq || '%'
          or t.applicant_name_normalized like '%' || nq || '%'
          or t.registration_number ilike q || '%'
          or t.application_number ilike q || '%'
          or t.id::text = q)
     and (nullif(btrim(p_gazette), '') is null or t.official_gazette_number = btrim(p_gazette))
     and (coalesce(p_status, 'all') = 'all'
          or (p_status = 'published' and t.is_published)
          or (p_status = 'archived' and not t.is_published))
     and (p_job_id is null or t.import_job_id = p_job_id or t.created_by_job_id = p_job_id)
     and (coalesce(p_images, 'all') = 'all'
          or (p_images = 'with' and exists (select 1 from public.trademark_images i where i.trademark_id = t.id and i.status = 'matched'))
          or (p_images = 'without' and not exists (select 1 from public.trademark_images i where i.trademark_id = t.id and i.status = 'matched')))
   order by
     case when p_sort = 'serial' then public.gazette_sort_key(t.official_gazette_number) end asc nulls last,
     case when p_sort = 'serial' then t.serial_number end asc,
     case when p_sort = 'created' then t.created_at end desc,
     case when p_sort = 'mark' then t.mark_name_normalized end asc,
     t.updated_at desc, t.serial_number asc
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
   offset greatest(coalesce(p_offset, 0), 0);
end $$;

create or replace function public.admin_get_trademark(p_id uuid)
returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare
  v_t jsonb;
begin
  perform public.admin_assert();
  select to_jsonb(t) into v_t from public.trademarks t where t.id = p_id;
  if v_t is null then
    return null;
  end if;
  return jsonb_build_object(
    'trademark', v_t - 'search_vector',
    'images', coalesce((select jsonb_agg(to_jsonb(i) order by i.sort_order, i.created_at)
                          from public.trademark_images i where i.trademark_id = p_id), '[]'::jsonb),
    'feature_count', (select count(*) from public.trademark_image_features f where f.trademark_id = p_id),
    'created_job', (select to_jsonb(j) from public.import_jobs j where j.id = (v_t ->> 'created_by_job_id')::uuid),
    'last_job',    (select to_jsonb(j) from public.import_jobs j where j.id = (v_t ->> 'import_job_id')::uuid),
    'audit', coalesce((select jsonb_agg(jsonb_build_object(
                           'id', a.id, 'action', a.action, 'changed_fields', a.changed_fields,
                           'actor_id', a.actor_id, 'actor_role', a.actor_role, 'created_at', a.created_at)
                         order by a.created_at desc)
                       from (select * from public.audit_logs a
                              where a.table_name = 'trademarks' and a.row_id = p_id::text
                              order by a.created_at desc limit 25) a), '[]'::jsonb),
    'admin_actions', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc)
                               from (select * from public.admin_actions x
                                      where p_id::text = any (x.target_ids)
                                      order by x.created_at desc limit 10) x), '[]'::jsonb));
end $$;

create or replace function public.admin_list_images(
  p_query text default null, p_status text default 'all', p_job_id uuid default null,
  p_linked text default 'all', p_limit int default 50, p_offset int default 0)
returns table (
  id uuid, trademark_id uuid, image_type text, status text, match_method text, storage_bucket text,
  storage_path text, thumbnail_path text, original_filename text, source_folder text,
  gazette_number text, serial_number text, width int, height int, byte_size bigint, content_type text,
  content_hash text, sort_order int, import_job_id uuid, created_by_job_id uuid, review_note text,
  created_at timestamptz, updated_at timestamptz,
  tm_serial text, tm_mark_name text, tm_published boolean, has_features boolean, total_count bigint)
language plpgsql security definer stable set search_path = public as $$
declare
  q text := nullif(btrim(p_query), '');
begin
  perform public.admin_assert();
  return query
  select i.id, i.trademark_id, i.image_type, i.status, i.match_method, i.storage_bucket,
         i.storage_path, i.thumbnail_path, i.original_filename, i.source_folder,
         i.gazette_number, i.serial_number, i.width, i.height, i.byte_size, i.content_type,
         i.content_hash, i.sort_order, i.import_job_id, i.created_by_job_id, i.review_note,
         i.created_at, i.updated_at,
         t.serial_number, t.mark_name, t.is_published,
         exists (select 1 from public.trademark_image_features f where f.image_id = i.id),
         count(*) over ()
    from public.trademark_images i
    left join public.trademarks t on t.id = i.trademark_id
   where (q is null
          or i.storage_path ilike '%' || q || '%'
          or i.original_filename ilike '%' || q || '%'
          or i.serial_number ilike q || '%'
          or t.serial_number ilike q || '%'
          or t.mark_name ilike '%' || q || '%'
          or i.id::text = q)
     and (coalesce(p_status, 'all') = 'all' or i.status = p_status)
     and (p_job_id is null or i.import_job_id = p_job_id or i.created_by_job_id = p_job_id)
     and (coalesce(p_linked, 'all') = 'all'
          or (p_linked = 'linked' and i.trademark_id is not null)
          or (p_linked = 'unlinked' and i.trademark_id is null))
   order by i.created_at desc, i.id
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
   offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- Given object paths listed from Storage by the browser, return the ones no
-- image row references (candidates for "Orphaned Files"). Paths queued for
-- cleanup are reported separately so they are not double-handled.
create or replace function public.admin_unreferenced_paths(p_paths text[])
returns table (path text, queued boolean)
language plpgsql security definer stable set search_path = public as $$
begin
  perform public.admin_assert();
  if coalesce(array_length(p_paths, 1), 0) > 5000 then
    raise exception 'At most 5000 paths per call' using errcode = '22023';
  end if;
  return query
  select p.path,
         exists (select 1 from public.storage_cleanup_queue q
                  where q.bucket = 'trademark-images' and q.path = p.path and q.status in ('pending', 'failed'))
    from unnest(p_paths) as p(path)
   where p.path is not null
     and not exists (select 1 from public.trademark_images i
                      where i.storage_bucket = 'trademark-images'
                        and (i.storage_path = p.path or i.thumbnail_path = p.path));
end $$;

-- All Storage paths referenced by image rows (paged) — lets the browser detect
-- rows whose object is missing from Storage ("broken images").
create or replace function public.admin_image_storage_paths(p_limit int default 10000, p_offset int default 0)
returns table (image_id uuid, path text, kind text)
language plpgsql security definer stable set search_path = public as $$
begin
  perform public.admin_assert();
  return query
  select x.image_id, x.path, x.kind from (
    select i.id as image_id, i.storage_path as path, 'image'::text as kind, i.created_at, 0 as k from public.trademark_images i
     where i.storage_bucket = 'trademark-images'
    union all
    select i.id, i.thumbnail_path, 'thumbnail', i.created_at, 1 from public.trademark_images i
     where i.storage_bucket = 'trademark-images' and i.thumbnail_path is not null) x
   order by x.created_at, x.image_id, x.k
   limit least(greatest(coalesce(p_limit, 10000), 1), 10000) offset greatest(coalesce(p_offset, 0), 0);
end $$;

create or replace function public.admin_list_import_jobs(
  p_type text default 'all', p_status text default 'all', p_limit int default 50, p_offset int default 0)
returns table (
  id uuid, job_type text, filename text, gazette_number text, dry_run boolean, status text,
  started_at timestamptz, completed_at timestamptz, total_rows int, inserted_rows int, updated_rows int,
  skipped_rows int, failed_rows int, error_message text, summary jsonb, created_by uuid, created_at timestamptz,
  created_trademarks bigint, updated_trademarks bigint, created_images bigint, failed_items bigint,
  total_count bigint)
language plpgsql security definer stable set search_path = public as $$
begin
  perform public.admin_assert();
  return query
  select j.id, j.job_type, j.filename, j.gazette_number, j.dry_run, j.status,
         j.started_at, j.completed_at, j.total_rows, j.inserted_rows, j.updated_rows,
         j.skipped_rows, j.failed_rows, j.error_message, j.summary, j.created_by, j.created_at,
         (select count(*) from public.trademarks t where t.created_by_job_id = j.id),
         (select count(*) from public.trademarks t where t.import_job_id = j.id and t.created_by_job_id is distinct from j.id),
         (select count(*) from public.trademark_images i where i.created_by_job_id = j.id),
         (select count(*) from public.import_job_items it where it.job_id = j.id and it.status in ('failed', 'unmatched', 'ambiguous')),
         count(*) over ()
    from public.import_jobs j
   where (coalesce(p_type, 'all') = 'all' or j.job_type = p_type)
     and (coalesce(p_status, 'all') = 'all'
          or (p_status = 'running' and j.status in ('queued', 'processing'))
          or j.status = p_status)
   order by j.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
   offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- Records a batch is responsible for, with the "modified later" flag used by
-- delete-by-batch. kind: created | updated | images
create or replace function public.admin_import_job_records(
  p_job_id uuid, p_kind text default 'created', p_limit int default 100, p_offset int default 0)
returns table (
  id uuid, serial_number text, mark_name text, official_gazette_number text, is_published boolean,
  storage_path text, image_status text, created_at timestamptz, updated_at timestamptz,
  modified_later boolean, modified_by_job uuid, total_count bigint)
language plpgsql security definer stable set search_path = public as $$
declare
  v_done timestamptz;
begin
  perform public.admin_assert();
  select coalesce(j.completed_at, j.started_at, j.created_at) + interval '1 minute' into v_done
    from public.import_jobs j where j.id = p_job_id;
  if p_kind = 'images' then
    return query
    select i.id, coalesce(t.serial_number, i.serial_number), t.mark_name, coalesce(t.official_gazette_number, i.gazette_number),
           t.is_published, i.storage_path, i.status, i.created_at, i.updated_at,
           (i.import_job_id is distinct from p_job_id) as modified_later,
           case when i.import_job_id is distinct from p_job_id then i.import_job_id end,
           count(*) over ()
      from public.trademark_images i
      left join public.trademarks t on t.id = i.trademark_id
     where i.created_by_job_id = p_job_id
     order by i.created_at, i.id
     limit least(greatest(coalesce(p_limit, 100), 1), 500) offset greatest(coalesce(p_offset, 0), 0);
  else
    return query
    select t.id, t.serial_number, t.mark_name, t.official_gazette_number, t.is_published,
           null::text, null::text, t.created_at, t.updated_at,
           (t.import_job_id is distinct from p_job_id
            or exists (select 1 from public.audit_logs a
                        where a.table_name = 'trademarks' and a.row_id = t.id::text
                          and a.action = 'UPDATE' and a.created_at > v_done
                          and coalesce(a.new_data ->> 'import_job_id', '') is distinct from p_job_id::text)) as modified_later,
           case when t.import_job_id is distinct from p_job_id then t.import_job_id end,
           count(*) over ()
      from public.trademarks t
     where case when p_kind = 'updated'
                then t.id in (select (it.payload ->> 'trademark_id')::uuid from public.import_job_items it
                               where it.job_id = p_job_id and it.status = 'updated' and it.payload ? 'trademark_id')
                else t.created_by_job_id = p_job_id end
     order by t.created_at, t.serial_number
     limit least(greatest(coalesce(p_limit, 100), 1), 500) offset greatest(coalesce(p_offset, 0), 0);
  end if;
end $$;

create or replace function public.admin_import_job_detail(p_job_id uuid)
returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare
  v_job jsonb;
begin
  perform public.admin_assert();
  select to_jsonb(j) into v_job from public.import_jobs j where j.id = p_job_id;
  return jsonb_build_object(
    'job', v_job,
    'counts', jsonb_build_object(
      'created_trademarks', (select count(*) from public.trademarks t where t.created_by_job_id = p_job_id),
      'updated_trademarks', (select count(distinct it.payload ->> 'trademark_id') from public.import_job_items it
                              where it.job_id = p_job_id and it.status = 'updated'),
      'touched_trademarks', (select count(*) from public.trademarks t where t.import_job_id = p_job_id),
      'created_images',     (select count(*) from public.trademark_images i where i.created_by_job_id = p_job_id),
      'touched_images',     (select count(*) from public.trademark_images i where i.import_job_id = p_job_id),
      'items_failed',       (select count(*) from public.import_job_items it where it.job_id = p_job_id and it.status = 'failed'),
      'items_unmatched',    (select count(*) from public.import_job_items it where it.job_id = p_job_id and it.status in ('unmatched', 'ambiguous')),
      'items_skipped',      (select count(*) from public.import_job_items it where it.job_id = p_job_id and it.status = 'skipped'),
      'has_row_provenance', (select exists (select 1 from public.import_job_items it where it.job_id = p_job_id and it.status in ('inserted', 'updated')))),
    'problems', coalesce((select jsonb_agg(to_jsonb(x) order by x.id)
                          from (select it.id, it.item_ref, it.status, it.message, it.payload
                                  from public.import_job_items it
                                 where it.job_id = p_job_id and it.status in ('failed', 'unmatched', 'ambiguous', 'skipped')
                                 order by it.id limit 500) x), '[]'::jsonb),
    'admin_actions', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc)
                               from (select * from public.admin_actions a where a.job_id = p_job_id
                                      order by a.created_at desc limit 20) a), '[]'::jsonb));
end $$;

create or replace function public.admin_list_admin_actions(
  p_action text default null, p_job_id uuid default null, p_limit int default 50, p_offset int default 0)
returns table (
  id bigint, actor_id uuid, actor_email text, action text, target_type text, target_ids text[],
  serials text[], storage_paths text[], job_id uuid, affected_count int, status text, details jsonb,
  created_at timestamptz, total_count bigint)
language plpgsql security definer stable set search_path = public as $$
begin
  perform public.admin_assert();
  return query
  select a.id, a.actor_id, a.actor_email, a.action, a.target_type, a.target_ids, a.serials, a.storage_paths,
         a.job_id, a.affected_count, a.status, a.details, a.created_at, count(*) over ()
    from public.admin_actions a
   where (nullif(p_action, '') is null or a.action like p_action || '%')
     and (p_job_id is null or a.job_id = p_job_id)
   order by a.created_at desc, a.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end $$;

create or replace function public.admin_list_audit_logs(
  p_table text default null, p_action text default null, p_row_id text default null,
  p_limit int default 50, p_offset int default 0)
returns table (
  id bigint, table_name text, row_id text, action text, changed_fields jsonb, actor_id uuid,
  actor_role text, created_at timestamptz, serial text, total_count bigint)
language plpgsql security definer stable set search_path = public as $$
begin
  perform public.admin_assert();
  return query
  select a.id, a.table_name, a.row_id, a.action, a.changed_fields, a.actor_id, a.actor_role, a.created_at,
         coalesce(a.new_data ->> 'serial_number', a.old_data ->> 'serial_number'),
         count(*) over ()
    from public.audit_logs a
   where (nullif(p_table, '') is null or a.table_name = p_table)
     and (nullif(p_action, '') is null or a.action = p_action)
     and (nullif(p_row_id, '') is null or a.row_id = p_row_id)
   order by a.created_at desc, a.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- -----------------------------------------------------------------------------
-- 6. Mutations. Every function: admin_assert, server-side validation, bounded
--    input, explicit confirmation token for permanent deletion, admin_actions
--    row, Storage paths queued (never silently dropped).
-- -----------------------------------------------------------------------------
create or replace function public.admin_set_trademarks_published(p_ids uuid[], p_published boolean, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_serials text[];
  v_ids     uuid[];
  n int;
  v_action bigint;
begin
  perform public.admin_assert();
  if coalesce(array_length(p_ids, 1), 0) = 0 then
    raise exception 'No records selected' using errcode = '22023';
  end if;
  if array_length(p_ids, 1) > 500 then
    raise exception 'At most 500 records per operation' using errcode = '22023';
  end if;
  with upd as (
    update public.trademarks t
       set is_published = p_published
     where t.id = any (p_ids) and t.is_published is distinct from p_published
    returning t.id, t.serial_number)
  select count(*), coalesce(array_agg(id), '{}'), coalesce(array_agg(serial_number order by serial_number), '{}')
    into n, v_ids, v_serials from upd;
  v_action := public.admin_record_action(
    case when p_published then 'trademarks.restore' else 'trademarks.archive' end, 'trademark',
    v_ids::text[], v_serials, '{}', null, n, 'success',
    jsonb_build_object('requested', array_length(p_ids, 1), 'reason', left(p_reason, 500)));
  return jsonb_build_object('affected', n, 'serials', to_jsonb(v_serials), 'action_id', v_action);
end $$;

create or replace function public.admin_delete_trademarks(p_ids uuid[], p_confirm text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_serials text[];
  v_ids     uuid[];
  v_paths   text[];
  n_tm int := 0;
  n_img int := 0;
  n_q int := 0;
  v_action bigint;
begin
  perform public.admin_assert();
  if coalesce(array_length(p_ids, 1), 0) = 0 then
    raise exception 'No records selected' using errcode = '22023';
  end if;
  if array_length(p_ids, 1) > 500 then
    raise exception 'At most 500 records per operation' using errcode = '22023';
  end if;
  if p_confirm is distinct from 'DELETE' then
    raise exception 'Permanent deletion requires the confirmation token DELETE' using errcode = '22023';
  end if;
  -- collect what will go (images cascade with the trademark rows)
  select coalesce(array_agg(p), '{}') into v_paths
    from (select i.storage_path as p from public.trademark_images i where i.trademark_id = any (p_ids)
          union select i.thumbnail_path from public.trademark_images i where i.trademark_id = any (p_ids) and i.thumbnail_path is not null) x;
  select count(*) into n_img from public.trademark_images i where i.trademark_id = any (p_ids);
  with del as (
    delete from public.trademarks t where t.id = any (p_ids)
    returning t.id, t.serial_number)
  select count(*), coalesce(array_agg(id), '{}'), coalesce(array_agg(serial_number order by serial_number), '{}')
    into n_tm, v_ids, v_serials from del;
  v_action := public.admin_record_action('trademarks.delete', 'trademark', v_ids::text[], v_serials, v_paths, null, n_tm,
    case when n_tm = array_length(p_ids, 1) then 'success' else 'partial' end,
    jsonb_build_object('requested', array_length(p_ids, 1), 'images_deleted', n_img,
                       'missing', (select count(*) from unnest(p_ids) x where x <> all (v_ids))));
  n_q := public.admin_enqueue_storage_cleanup(v_paths, 'trademarks.delete', v_action);
  return jsonb_build_object('deleted', n_tm, 'images_deleted', n_img, 'storage_queued', n_q,
                            'serials', to_jsonb(v_serials), 'action_id', v_action);
end $$;

create or replace function public.admin_delete_images(p_ids uuid[], p_confirm text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_paths   text[];
  v_ids     uuid[];
  v_serials text[];
  n int := 0;
  n_q int := 0;
  v_action bigint;
begin
  perform public.admin_assert();
  if coalesce(array_length(p_ids, 1), 0) = 0 then
    raise exception 'No images selected' using errcode = '22023';
  end if;
  if array_length(p_ids, 1) > 500 then
    raise exception 'At most 500 images per operation' using errcode = '22023';
  end if;
  if p_confirm is distinct from 'DELETE' then
    raise exception 'Permanent deletion requires the confirmation token DELETE' using errcode = '22023';
  end if;
  with del as (
    delete from public.trademark_images i where i.id = any (p_ids)
    returning i.id, i.storage_path, i.thumbnail_path, coalesce(i.serial_number, i.storage_path) as serial)
  select count(*), coalesce(array_agg(id), '{}'),
         coalesce(array_agg(serial order by serial), '{}'),
         coalesce(array_agg(storage_path) || array_remove(array_agg(thumbnail_path), null), '{}')
    into n, v_ids, v_serials, v_paths from del;
  v_action := public.admin_record_action('images.delete', 'image', v_ids::text[], v_serials, v_paths, null, n,
    case when n = array_length(p_ids, 1) then 'success' else 'partial' end,
    jsonb_build_object('requested', array_length(p_ids, 1)));
  n_q := public.admin_enqueue_storage_cleanup(v_paths, 'images.delete', v_action);
  return jsonb_build_object('deleted', n, 'storage_queued', n_q, 'paths', to_jsonb(v_paths), 'action_id', v_action);
end $$;

-- Delete the RECORDS an import batch created (never the ones it only updated).
-- p_confirm null → preview only (nothing changes, nothing logged).
create or replace function public.admin_delete_import_job_records(
  p_job_id uuid, p_confirm text default null, p_include_modified boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_job     public.import_jobs;
  v_done    timestamptz;
  v_tm_ids  uuid[];
  v_mod_ids uuid[];
  v_img_ids uuid[];
  v_serials text[];
  v_paths   text[];
  n_tm int := 0;
  n_img int := 0;
  n_q int := 0;
  v_action bigint;
begin
  perform public.admin_assert();
  select * into v_job from public.import_jobs j where j.id = p_job_id;
  if v_job.id is null then
    raise exception 'Unknown import job %', p_job_id using errcode = '22023';
  end if;
  if v_job.status in ('queued', 'processing') then
    raise exception 'The import is still running — cancel it first' using errcode = '55000';
  end if;
  v_done := coalesce(v_job.completed_at, v_job.started_at, v_job.created_at) + interval '1 minute';

  -- trademarks created by this batch, split by "modified afterwards"
  select coalesce(array_agg(t.id) filter (where not m.modified), '{}'),
         coalesce(array_agg(t.id) filter (where m.modified), '{}')
    into v_tm_ids, v_mod_ids
    from public.trademarks t
    cross join lateral (select (t.import_job_id is distinct from p_job_id
            or exists (select 1 from public.audit_logs a
                        where a.table_name = 'trademarks' and a.row_id = t.id::text
                          and a.action = 'UPDATE' and a.created_at > v_done
                          and coalesce(a.new_data ->> 'import_job_id', '') is distinct from p_job_id::text)) as modified) m
   where t.created_by_job_id = p_job_id;
  if p_include_modified then
    v_tm_ids := v_tm_ids || v_mod_ids;
  end if;
  -- images created by this batch (image batches) + images of the trademarks above (cascade)
  select coalesce(array_agg(i.id), '{}') into v_img_ids
    from public.trademark_images i
   where i.created_by_job_id = p_job_id or i.trademark_id = any (v_tm_ids);
  select coalesce(array_agg(p), '{}') into v_paths
    from (select i.storage_path as p from public.trademark_images i where i.id = any (v_img_ids)
          union select i.thumbnail_path from public.trademark_images i where i.id = any (v_img_ids) and i.thumbnail_path is not null) x;
  select coalesce(array_agg(t.serial_number order by t.serial_number), '{}') into v_serials
    from public.trademarks t where t.id = any (v_tm_ids);

  if p_confirm is distinct from 'DELETE' then
    return jsonb_build_object(
      'preview', true,
      'job', jsonb_build_object('id', v_job.id, 'job_type', v_job.job_type, 'filename', v_job.filename, 'status', v_job.status),
      'trademarks', coalesce(array_length(v_tm_ids, 1), 0),
      'trademarks_modified_later', coalesce(array_length(v_mod_ids, 1), 0),
      'include_modified', p_include_modified,
      'images', coalesce(array_length(v_img_ids, 1), 0),
      'storage_objects', coalesce(array_length(v_paths, 1), 0),
      'serials', to_jsonb(v_serials[1:50]),
      'updated_only', (select count(*) from public.trademarks t where t.import_job_id = p_job_id and t.created_by_job_id is distinct from p_job_id),
      'has_provenance', (coalesce(array_length(v_tm_ids, 1), 0) + coalesce(array_length(v_mod_ids, 1), 0) + coalesce(array_length(v_img_ids, 1), 0)) > 0);
  end if;

  delete from public.trademarks t where t.id = any (v_tm_ids);
  get diagnostics n_tm = row_count;
  delete from public.trademark_images i where i.id = any (v_img_ids);   -- image-batch rows (others cascaded already)
  get diagnostics n_img = row_count;
  v_action := public.admin_record_action('import_job.delete_records', 'import_job',
    v_tm_ids::text[], v_serials, v_paths, p_job_id, n_tm + n_img, 'success',
    jsonb_build_object('trademarks', n_tm, 'images', coalesce(array_length(v_img_ids, 1), 0),
                       'include_modified', p_include_modified,
                       'modified_skipped', case when p_include_modified then 0 else coalesce(array_length(v_mod_ids, 1), 0) end,
                       'filename', v_job.filename, 'job_type', v_job.job_type));
  n_q := public.admin_enqueue_storage_cleanup(v_paths, 'import_job.delete_records', v_action);
  return jsonb_build_object('preview', false, 'trademarks', n_tm, 'images', coalesce(array_length(v_img_ids, 1), 0),
                            'storage_queued', n_q, 'serials', to_jsonb(v_serials[1:50]), 'action_id', v_action,
                            'modified_skipped', case when p_include_modified then 0 else coalesce(array_length(v_mod_ids, 1), 0) end);
end $$;

-- Delete only the import job record (history entry + its item log). The
-- trademark/image rows it created stay untouched; their provenance ids remain.
create or replace function public.admin_delete_import_job(p_job_id uuid, p_confirm text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_job public.import_jobs;
  n_items int;
  v_action bigint;
begin
  perform public.admin_assert();
  select * into v_job from public.import_jobs j where j.id = p_job_id;
  if v_job.id is null then
    raise exception 'Unknown import job %', p_job_id using errcode = '22023';
  end if;
  if v_job.status in ('queued', 'processing') then
    raise exception 'The import is still running — cancel it first' using errcode = '55000';
  end if;
  if p_confirm is distinct from 'DELETE' then
    raise exception 'Deleting an import record requires the confirmation token DELETE' using errcode = '22023';
  end if;
  select count(*) into n_items from public.import_job_items it where it.job_id = p_job_id;
  delete from public.import_jobs j where j.id = p_job_id;
  v_action := public.admin_record_action('import_job.delete', 'import_job', array[p_job_id::text], '{}', '{}', p_job_id, 1, 'success',
    jsonb_build_object('filename', v_job.filename, 'job_type', v_job.job_type, 'status', v_job.status,
                       'items_deleted', n_items, 'created_at', v_job.created_at,
                       'records_kept', (select count(*) from public.trademarks t where t.created_by_job_id = p_job_id)));
  return jsonb_build_object('deleted', 1, 'items_deleted', n_items, 'action_id', v_action);
end $$;

create or replace function public.admin_cancel_import_job(p_job_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_action bigint;
begin
  perform public.admin_assert();
  select status into v_status from public.import_jobs where id = p_job_id;
  if v_status is null then
    raise exception 'Unknown import job %', p_job_id using errcode = '22023';
  end if;
  if v_status not in ('queued', 'processing') then
    raise exception 'Only queued or processing imports can be cancelled (status: %)', v_status using errcode = '55000';
  end if;
  update public.import_jobs
     set status = 'failed',
         completed_at = now(),
         error_message = left(coalesce('Cancelled by administrator' || nullif(': ' || p_reason, ': '), 'Cancelled by administrator'), 1000),
         summary = coalesce(summary, '{}'::jsonb) || jsonb_build_object('cancelled', true, 'cancelled_at', now())
   where id = p_job_id;
  v_action := public.admin_record_action('import_job.cancel', 'import_job', array[p_job_id::text], '{}', '{}', p_job_id, 1, 'success',
    jsonb_build_object('previous_status', v_status, 'reason', left(p_reason, 500)));
  return jsonb_build_object('cancelled', true, 'action_id', v_action);
end $$;

-- Retention: remove finished job records older than N days (≥ 7). Records and
-- images are never touched; only history rows + their item logs.
create or replace function public.admin_purge_import_jobs(p_older_than_days int, p_confirm text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[];
  n int;
  v_action bigint;
begin
  perform public.admin_assert();
  if coalesce(p_older_than_days, 0) < 7 then
    raise exception 'Retention cleanup keeps at least the last 7 days' using errcode = '22023';
  end if;
  select coalesce(array_agg(j.id), '{}') into v_ids
    from public.import_jobs j
   where j.status not in ('queued', 'processing')
     and coalesce(j.completed_at, j.created_at) < now() - make_interval(days => p_older_than_days);
  if p_confirm is distinct from 'DELETE' then
    return jsonb_build_object('preview', true, 'jobs', coalesce(array_length(v_ids, 1), 0),
                              'items', (select count(*) from public.import_job_items it where it.job_id = any (v_ids)));
  end if;
  delete from public.import_jobs j where j.id = any (v_ids);
  get diagnostics n = row_count;
  v_action := public.admin_record_action('import_job.purge', 'import_job', v_ids::text[], '{}', '{}', null, n, 'success',
    jsonb_build_object('older_than_days', p_older_than_days));
  return jsonb_build_object('preview', false, 'jobs', n, 'action_id', v_action);
end $$;

-- Grants for everything above
revoke all on function public.admin_log_action(text, text, text[], text, jsonb)                      from public, anon;
revoke all on function public.admin_storage_cleanup_list(text, int)                                 from public, anon;
revoke all on function public.admin_storage_cleanup_mark(bigint[], text, text)                      from public, anon;
revoke all on function public.admin_data_overview()                                                 from public, anon;
revoke all on function public.admin_search_trademarks(text, text, text, uuid, text, text, int, int) from public, anon;
revoke all on function public.admin_get_trademark(uuid)                                             from public, anon;
revoke all on function public.admin_list_images(text, text, uuid, text, int, int)                   from public, anon;
revoke all on function public.admin_unreferenced_paths(text[])                                      from public, anon;
revoke all on function public.admin_image_storage_paths(int, int)                                   from public, anon;
revoke all on function public.admin_list_import_jobs(text, text, int, int)                          from public, anon;
revoke all on function public.admin_import_job_records(uuid, text, int, int)                        from public, anon;
revoke all on function public.admin_import_job_detail(uuid)                                         from public, anon;
revoke all on function public.admin_list_admin_actions(text, uuid, int, int)                        from public, anon;
revoke all on function public.admin_list_audit_logs(text, text, text, int, int)                     from public, anon;
revoke all on function public.admin_set_trademarks_published(uuid[], boolean, text)                 from public, anon;
revoke all on function public.admin_delete_trademarks(uuid[], text)                                 from public, anon;
revoke all on function public.admin_delete_images(uuid[], text)                                     from public, anon;
revoke all on function public.admin_delete_import_job_records(uuid, text, boolean)                  from public, anon;
revoke all on function public.admin_delete_import_job(uuid, text)                                   from public, anon;
revoke all on function public.admin_cancel_import_job(uuid, text)                                   from public, anon;
revoke all on function public.admin_purge_import_jobs(int, text)                                    from public, anon;
revoke all on function public.audit_rows_are_immutable()                                            from public, anon, authenticated;
grant execute on function
  public.admin_log_action(text, text, text[], text, jsonb),
  public.admin_storage_cleanup_list(text, int),
  public.admin_storage_cleanup_mark(bigint[], text, text),
  public.admin_data_overview(),
  public.admin_search_trademarks(text, text, text, uuid, text, text, int, int),
  public.admin_get_trademark(uuid),
  public.admin_list_images(text, text, uuid, text, int, int),
  public.admin_unreferenced_paths(text[]),
  public.admin_image_storage_paths(int, int),
  public.admin_list_import_jobs(text, text, int, int),
  public.admin_import_job_records(uuid, text, int, int),
  public.admin_import_job_detail(uuid),
  public.admin_list_admin_actions(text, uuid, int, int),
  public.admin_list_audit_logs(text, text, text, int, int),
  public.admin_set_trademarks_published(uuid[], boolean, text),
  public.admin_delete_trademarks(uuid[], text),
  public.admin_delete_images(uuid[], text),
  public.admin_delete_import_job_records(uuid, text, boolean),
  public.admin_delete_import_job(uuid, text),
  public.admin_cancel_import_job(uuid, text),
  public.admin_purge_import_jobs(int, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 7. Public API hardening
--    * anon / authenticated keep SELECT on trademarks and trademark_images, but
--      only on the public columns — attorney_or_representative, review fields,
--      source-file provenance and import ids are no longer readable through
--      PostgREST. Administrators read full rows via the admin_* functions.
--    * attorney_or_representative leaves the public search result type; the
--      p_attorney parameter of search_trademarks stays (ignored) so existing
--      clients keep working.
-- -----------------------------------------------------------------------------
revoke select on table public.trademarks from anon, authenticated;
grant select (
  id, record_number, serial_number, mark_name, mark_print, applicant_name, applicant_address,
  trademark_class, goods_and_services, application_type, publication_date, objection_deadline,
  official_gazette_number, registration_number, application_number, new_address, old_address,
  new_owner, old_owner, source_page, created_at, updated_at, is_published, review_status,
  mark_name_normalized, applicant_name_normalized, goods_and_services_normalized,
  serial_number_normalized, class_numbers, search_vector)
  on public.trademarks to anon, authenticated;

revoke select on table public.trademark_images from anon, authenticated;
grant select (
  id, trademark_id, image_type, status, storage_bucket, storage_path, thumbnail_path,
  gazette_number, serial_number, width, height, byte_size, content_type, sort_order,
  created_at, updated_at)
  on public.trademark_images to anon, authenticated;

do $$ begin
  if exists (select 1 from pg_attribute
              where attrelid = 'public.trademark_search_result'::regclass and attname = 'attorney_or_representative' and not attisdropped) then
    alter type public.trademark_search_result drop attribute attorney_or_representative;
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.search_trademarks(p_query text DEFAULT NULL::text, p_mark text DEFAULT NULL::text, p_applicant text DEFAULT NULL::text, p_serial text DEFAULT NULL::text, p_gazette text DEFAULT NULL::text, p_classes integer[] DEFAULT NULL::integer[], p_goods text DEFAULT NULL::text, p_application_type text DEFAULT NULL::text, p_attorney text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_fuzzy boolean DEFAULT true, p_sort text DEFAULT 'relevance'::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS SETOF trademark_search_result
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  nq        text    := public.normalize_text(p_query);
  tsq       tsquery := public.to_prefix_tsquery(p_query);
  n_mark    text    := public.normalize_text(p_mark);
  n_app     text    := public.normalize_text(p_applicant);
  n_serial  text    := public.normalize_text(p_serial);
  n_goods   text    := public.normalize_text(p_goods);
  n_gaz     text    := nullif(btrim(coalesce(p_gazette, '')), '');
  n_type    text    := nullif(btrim(coalesce(p_application_type, '')), '');
  v_classes int[]   := case when p_classes is null or cardinality(p_classes) = 0 then null else p_classes end;
  v_sort    text    := coalesce(p_sort, 'relevance');
  v_limit   int     := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset  int     := greatest(coalesce(p_offset, 0), 0);
begin
  if v_offset > 10000 then
    raise exception 'Result window too large (offset %). Narrow the search.', v_offset
      using errcode = '22023';
  end if;
  if v_sort not in ('relevance', 'newest', 'oldest', 'mark_asc', 'mark_desc', 'serial') then
    v_sort := 'relevance';
  end if;
  if v_sort = 'relevance' and nq is null then
    v_sort := 'newest';
  end if;

  return query
  with base as (
    select t.id, t.serial_number, t.record_number, t.mark_name, t.applicant_name, t.applicant_address,
           t.trademark_class, t.class_numbers, t.goods_and_services, t.application_type,
           t.publication_date, t.objection_deadline,
           t.official_gazette_number, t.source_page, t.review_status,
           t.mark_name_normalized,
           case when nq is null then 0::real else greatest(
             case when t.mark_name_normalized = nq or t.serial_number_normalized = nq then 10 else 0 end,
             case when t.mark_name_normalized like nq || '%' then 5 else 0 end,
             case when t.applicant_name_normalized = nq then 4 else 0 end,
             coalesce(ts_rank_cd(t.search_vector, tsq), 0) * 3,
             similarity(coalesce(t.mark_name_normalized, ''), nq) * 3,
             similarity(coalesce(t.applicant_name_normalized, ''), nq)
           )::real end as rank
      from public.trademarks t
     where t.is_published
       and (nq is null or (
                (tsq is not null and t.search_vector @@ tsq)
             or t.mark_name_normalized      ilike '%' || nq || '%'
             or t.applicant_name_normalized ilike '%' || nq || '%'
             or t.serial_number_normalized  ilike nq || '%'
             or t.official_gazette_number   = nq
             or (p_fuzzy and t.mark_name_normalized % nq)
           ))
       and (n_mark   is null or t.mark_name_normalized ilike '%' || n_mark || '%'
                             or (p_fuzzy and t.mark_name_normalized % n_mark))
       and (n_app    is null or t.applicant_name_normalized ilike '%' || n_app || '%')
       and (n_serial is null or t.serial_number_normalized ilike n_serial || '%')
       and (n_gaz    is null or t.official_gazette_number = n_gaz)
       and (v_classes is null or t.class_numbers && v_classes)
       and (n_goods  is null or t.goods_and_services_normalized ilike '%' || n_goods || '%')
       and (n_type   is null or lower(t.application_type) = lower(n_type))
       and (p_date_from is null or public.to_gregorian_date(t.publication_date) >= p_date_from)
       and (p_date_to   is null or public.to_gregorian_date(t.publication_date) <= p_date_to)
  ),
  page as (
    select b.*,
           count(*) over () as total_count,
           row_number() over (
             order by
               case when v_sort = 'relevance' then b.rank end desc nulls last,
               case when v_sort = 'newest'    then public.to_gregorian_date(b.publication_date) end desc nulls last,
               case when v_sort = 'oldest'    then public.to_gregorian_date(b.publication_date) end asc  nulls last,
               case when v_sort = 'mark_asc'  then b.mark_name_normalized end asc  nulls last,
               case when v_sort = 'mark_desc' then b.mark_name_normalized end desc nulls last,
               public.gazette_sort_key(b.official_gazette_number) desc nulls last,
               b.serial_number
           ) as rn
      from base b
     order by rn
     limit v_limit offset v_offset
  )
  select p.id, p.serial_number, p.record_number, p.mark_name, p.applicant_name, p.applicant_address,
         p.trademark_class, p.class_numbers, p.goods_and_services, p.application_type,
         p.publication_date, p.objection_deadline,
         p.official_gazette_number, p.source_page, p.review_status,
         img.storage_bucket, img.storage_path, img.thumbnail_path,
         p.rank, p.total_count
    from page p
    left join public.trademark_primary_images img on img.trademark_id = p.id
   order by p.rn;
end $function$;

create or replace function public.similar_trademarks(p_id uuid, p_limit integer default 8)
returns setof public.trademark_search_result
language sql stable set search_path = public, extensions as $$
  with src as (
    select id, mark_name_normalized from public.trademarks where id = p_id and is_published
  ),
  hits as (
    select t.id, t.serial_number, t.record_number, t.mark_name, t.applicant_name, t.applicant_address,
           t.trademark_class, t.class_numbers, t.goods_and_services, t.application_type,
           t.publication_date, t.objection_deadline, t.official_gazette_number, t.source_page,
           t.review_status,
           similarity(t.mark_name_normalized, s.mark_name_normalized) as sim
      from public.trademarks t
      cross join src s
     where t.id <> s.id
       and t.is_published
       and s.mark_name_normalized is not null
       and (t.mark_name_normalized % s.mark_name_normalized
            or t.mark_name_normalized like s.mark_name_normalized || '%'
            or s.mark_name_normalized like t.mark_name_normalized || '%')
     order by sim desc, public.to_gregorian_date(t.publication_date) desc nulls last
     limit least(greatest(coalesce(p_limit, 8), 1), 50)
  )
  select h.id, h.serial_number, h.record_number, h.mark_name, h.applicant_name, h.applicant_address,
         h.trademark_class, h.class_numbers, h.goods_and_services, h.application_type,
         h.publication_date, h.objection_deadline,
         h.official_gazette_number, h.source_page, h.review_status,
         img.storage_bucket, img.storage_path, img.thumbnail_path,
         h.sim::real as rank, count(*) over () as total_count
    from hits h
    left join public.trademark_primary_images img on img.trademark_id = h.id
   order by h.sim desc;
$$;

create or replace function public.recent_trademarks(p_limit integer default 8)
returns setof public.trademark_search_result
language sql stable set search_path = public as $$
  select t.id, t.serial_number, t.record_number, t.mark_name, t.applicant_name, t.applicant_address,
         t.trademark_class, t.class_numbers, t.goods_and_services, t.application_type,
         t.publication_date, t.objection_deadline,
         t.official_gazette_number, t.source_page, t.review_status,
         img.storage_bucket, img.storage_path, img.thumbnail_path,
         0::real as rank, count(*) over () as total_count
    from public.trademarks t
    left join public.trademark_primary_images img on img.trademark_id = t.id
   where t.is_published
   order by public.gazette_sort_key(t.official_gazette_number) desc nulls last,
            public.to_gregorian_date(t.publication_date) desc nulls last, t.created_at desc, t.serial_number
   limit least(greatest(coalesce(p_limit, 8), 1), 48);
$$;

-- search_trademarks_by_image changes its output row type → drop + recreate + re-grant
drop function if exists public.search_trademarks_by_image(double precision[], int, int, double precision);
CREATE OR REPLACE FUNCTION public.search_trademarks_by_image(p_embedding double precision[], p_version integer, p_limit integer DEFAULT 24, p_min_similarity double precision DEFAULT 0.55)
 RETURNS TABLE(id uuid, serial_number text, record_number text, mark_name text, applicant_name text, applicant_address text, trademark_class text, class_numbers integer[], goods_and_services text, application_type text, publication_date date, objection_deadline date, official_gazette_number text, source_page text, review_status text, primary_image_bucket text, primary_image_path text, primary_thumbnail_path text, rank real, total_count bigint, similarity double precision, matched_image_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_q      extensions.vector;
  v_limit  int := least(greatest(coalesce(p_limit, 24), 1), 50);
  v_min    double precision := least(greatest(coalesce(p_min_similarity, 0), 0), 1);
begin
  if p_embedding is null or coalesce(array_length(p_embedding, 1), 0) <> 369 then
    raise exception 'The image descriptor must contain exactly 369 values'
      using errcode = '22023';
  end if;
  if p_version is null then
    raise exception 'Descriptor version is required' using errcode = '22023';
  end if;
  v_q := p_embedding::extensions.vector(369);

  return query
  with scored as (
    -- candidate pool: nearest vectors of the same descriptor version
    select f.image_id, f.trademark_id,
           1 - (f.embedding operator(extensions.<=>) v_q) as sim
      from public.trademark_image_features f
     where f.descriptor_version = p_version
     order by f.embedding operator(extensions.<=>) v_q
     limit v_limit * 4
  ),
  best as (
    -- one row per trademark: its most similar image
    select distinct on (s.trademark_id) s.image_id, s.trademark_id, s.sim
      from scored s
     order by s.trademark_id, s.sim desc
  ),
  hits as (
    select b.image_id, b.trademark_id, b.sim
      from best b
      join public.trademarks t on t.id = b.trademark_id and t.is_published
     where b.sim >= v_min
  )
  select t.id, t.serial_number, t.record_number, t.mark_name, t.applicant_name, t.applicant_address,
         t.trademark_class, t.class_numbers, t.goods_and_services, t.application_type,
         t.publication_date, t.objection_deadline,
         t.official_gazette_number, t.source_page, t.review_status,
         i.storage_bucket, i.storage_path, i.thumbnail_path,
         h.sim::real                      as rank,
         (select count(*) from hits)      as total_count,
         h.sim                            as similarity,
         h.image_id                       as matched_image_id
    from hits h
    join public.trademarks t        on t.id = h.trademark_id
    join public.trademark_images i  on i.id = h.image_id
   order by h.sim desc, t.serial_number
   limit v_limit;
end $function$;
revoke all on function public.search_trademarks_by_image(double precision[], int, int, double precision) from public;
grant execute on function public.search_trademarks_by_image(double precision[], int, int, double precision) to anon, authenticated;

-- PostgREST: pick up the new functions/columns immediately
notify pgrst, 'reload schema';
