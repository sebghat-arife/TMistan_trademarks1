-- ============================================================================
-- TMistan — APPLY MIGRATION 1100 (direct trademark record editing)
--
-- Paste this whole file into the Supabase SQL Editor and click RUN once.
-- Generated from supabase/migrations/20261021001100_record_editing.sql by
-- scripts/build_apply_all.py — do not edit by hand, edit the migration.
--
-- Prerequisite: migration 0600 (APPLY_0600.sql) is in place — it created
-- admin_actions / admin_record_action and admin_get_trademark, which this
-- migration builds on. 0700–1000 are NOT required (but recommended).
--
-- What it adds: the "Edit record" button of Admin → Trademark Records.
--   • admin_update_trademark(id, patch, expected_updated_at, reason, release)
--     – the only write path for single-record corrections: administrator
--     role checked in the database, row located by its immutable uuid,
--     whitelist of editable columns, optimistic concurrency (HTTP 409 when
--     somebody else saved first — nothing is overwritten), duplicate
--     gazette + serial rejected with the other record named, every save
--     written to admin_actions (fields, before/after, reason) and audit_logs
--   • three provenance columns on public.trademarks
--     (manual_edit_fields, manual_edited_at, manual_edited_by) — fields
--     corrected by hand are KEPT when the Excel file is imported again; the
--     Import Center reports how many values were preserved
--   • admin_get_trademark returns the new columns
--
-- Safe by construction — ADDITIVE ONLY:
--   • adds three nullable columns (no rewrite of existing rows, no defaults
--     that touch data), one admin-only function, re-creates two existing
--     functions with the same names, signatures and callers
--   • touches no trademark, gazette, applicant or image row, no Storage object
--   • idempotent — running it twice is harmless
--
-- Until this file is applied the web app keeps working: the Edit button is
-- disabled and the record panel explains that migration 1100 is missing.
-- ============================================================================
begin;

-- ############################################################################
-- 20261021001100_record_editing.sql
-- ############################################################################
-- =============================================================================
-- 1100  DIRECT RECORD EDITING — administrators correct a trademark record in
--       TMistan itself; the database (not Excel) is the source of truth for
--       individual corrections.
--
-- What this migration adds (ADDITIVE ONLY — nothing is dropped, renamed,
-- reset or rewritten; no trademark/image row is modified by running it):
--
--   1. Three provenance columns on public.trademarks
--        manual_edit_fields  text[]  — columns corrected by hand in TMistan;
--                                      a later Excel import keeps these values
--        manual_edited_at    timestamptz / manual_edited_by uuid
--   2. admin_update_trademark(p_id, p_patch, p_expected_updated_at, p_reason,
--      p_release_protection) — the ONLY write path for single-record edits:
--        • admin_assert() (role check happens in the database, not the UI)
--        • row located by its immutable uuid and locked (FOR UPDATE)
--        • whitelist of editable columns; id, source_file/sheet/row, import
--          ids, created_at, updated_at, reviewed_* and generated columns are
--          never writable through it
--        • values trimmed, '' → NULL (legitimate empty values are preserved),
--          dates validated, review_status validated, serial/gazette required
--        • optimistic concurrency: a stale `updated_at` → SQLSTATE PT409
--          (HTTP 409) with hint 'stale' — nothing is overwritten
--        • duplicate (gazette, serial) → PT409 with hint 'duplicate' and the
--          other record in DETAIL — never a second record, never an overwrite
--        • only the supplied fields change; images, provenance, timestamps of
--          creation and import history are untouched (image rows only get
--          their denormalised serial/gazette label refreshed when those
--          identifiers change — same rows, same storage paths)
--        • updated_at via the existing trigger; the existing row-level audit
--          trigger records old/new values; one admin_actions entry
--          ('trademarks.edit') records actor e-mail, changed fields, before/
--          after values and the optional reason
--   3. admin_import_trademark_rows re-created with the SAME signature: when a
--      re-imported Excel row would overwrite a column listed in
--      manual_edit_fields, the TMistan value is kept and the row's import item
--      reports the preserved columns ("preserved"). Rows that were never
--      corrected by hand import exactly as before.
--
-- Idempotent: safe to run more than once.
-- =============================================================================
-- (transaction wrapper added by supabase/APPLY_1100.sql / APPLY_ALL.sql)

-- -----------------------------------------------------------------------------
-- 1. Provenance columns
-- -----------------------------------------------------------------------------
alter table public.trademarks
  add column if not exists manual_edit_fields text[] not null default '{}',
  add column if not exists manual_edited_at   timestamptz,
  add column if not exists manual_edited_by   uuid;

comment on column public.trademarks.manual_edit_fields is
  'Columns corrected by an administrator in TMistan (admin_update_trademark). Excel re-imports keep these values until the protection is released from the record editor.';
comment on column public.trademarks.manual_edited_at is 'Last manual correction (admin_update_trademark). created_at / import provenance are never changed by edits.';
comment on column public.trademarks.manual_edited_by is 'auth.uid() of the administrator who made the last manual correction.';

-- Not readable through the public API (anon/authenticated keep their
-- column-level SELECT list from 0600; administrators read full rows through
-- admin_get_trademark). Nothing to grant here.

-- -----------------------------------------------------------------------------
-- 2. admin_update_trademark
-- -----------------------------------------------------------------------------
create or replace function public.admin_update_trademark(
  p_id uuid,
  p_patch jsonb,
  p_expected_updated_at timestamptz default null,
  p_reason text default null,
  p_release_protection boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  -- columns an administrator may change through the record editor
  c_editable constant text[] := array[
    'record_number','serial_number','mark_name','mark_print','applicant_name','applicant_address',
    'trademark_class','goods_and_services','application_type','attorney_or_representative',
    'publication_date','objection_deadline','official_gazette_number','registration_number',
    'application_number','new_address','old_address','new_owner','old_owner','source_page',
    'review_note','review_comment','review_status','is_published'];
  -- columns the Excel importer writes (subset of the above that needs import protection)
  c_import_cols constant text[] := array[
    'record_number','serial_number','mark_name','mark_print','applicant_name','applicant_address',
    'trademark_class','goods_and_services','application_type','attorney_or_representative',
    'publication_date','objection_deadline','official_gazette_number','registration_number',
    'application_number','new_address','old_address','new_owner','old_owner','source_page',
    'review_note'];
  c_dates constant text[] := array['publication_date','objection_deadline'];
  v_old      public.trademarks;
  v_new      public.trademarks;
  v_clean    jsonb := '{}'::jsonb;
  v_key      text;
  v_val      jsonb;
  v_text     text;
  v_changed  text[] := '{}';
  v_before   jsonb := '{}'::jsonb;
  v_after    jsonb := '{}'::jsonb;
  v_protect  text[];
  v_dup      record;
  v_action   bigint;
  v_result   jsonb;
  v_n        int;
begin
  perform public.admin_assert();

  if p_id is null then
    raise exception 'Record id is required' using errcode = '22023';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'p_patch must be a JSON object mapping field names to values' using errcode = '22023';
  end if;

  -- 2a. locate the record by its immutable id and lock it for this transaction
  select * into v_old from public.trademarks t where t.id = p_id for update;
  if not found then
    raise exception 'Trademark record % no longer exists', p_id using errcode = 'P0002';
  end if;

  -- 2b. optimistic concurrency: the client sends the updated_at it displayed
  if p_expected_updated_at is not null and v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'This record was changed by someone else at % — reload it before saving.',
      to_char(v_old.updated_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS "UTC"')
      using errcode = 'PT409', hint = 'stale',
            detail = jsonb_build_object('updated_at', v_old.updated_at)::text;
  end if;

  -- 2c. validate + normalise every supplied field (unknown fields are rejected)
  for v_key, v_val in select key, value from jsonb_each(p_patch) loop
    if not (v_key = any (c_editable)) then
      raise exception 'Field "%" cannot be edited through the record editor', v_key using errcode = '22023';
    end if;

    if v_key = 'is_published' then
      if jsonb_typeof(v_val) <> 'boolean' then
        raise exception 'is_published must be true or false' using errcode = '22023';
      end if;
      v_clean := v_clean || jsonb_build_object(v_key, v_val);
      continue;
    end if;

    v_text := case
      when jsonb_typeof(v_val) = 'null'   then null
      when jsonb_typeof(v_val) = 'string' then nullif(btrim(v_val #>> '{}'), '')
      else nullif(btrim(v_val::text), '')
    end;
    if v_text is not null and length(v_text) > 20000 then
      raise exception 'Field "%" is too long (maximum 20000 characters)', v_key using errcode = '22023';
    end if;

    if v_key = any (c_dates) then
      if v_text is not null then
        if v_text !~ '^\d{4}-\d{2}-\d{2}$' then
          raise exception 'Field "%" must be a date in the form YYYY-MM-DD', v_key using errcode = '22023';
        end if;
        begin
          perform v_text::date;
        exception when others then
          raise exception 'Field "%" is not a valid calendar date', v_key using errcode = '22023';
        end;
      end if;
    elsif v_key = 'review_status' then
      if v_text is null or v_text not in ('unreviewed', 'reviewed', 'needs_correction', 'verified') then
        raise exception 'review_status must be one of: unreviewed, reviewed, needs_correction, verified' using errcode = '22023';
      end if;
    elsif v_key in ('serial_number', 'official_gazette_number') then
      if v_text is null then
        raise exception 'Field "%" is required', v_key using errcode = '23502';
      end if;
      if length(v_text) > 64 or v_text ~ '[[:cntrl:]]' then
        raise exception 'Field "%" is not a valid identifier', v_key using errcode = '22023';
      end if;
    elsif v_text is not null and v_key in ('record_number', 'registration_number', 'application_number', 'trademark_class', 'source_page', 'application_type')
          and length(v_text) > 500 then
      raise exception 'Field "%" is too long (maximum 500 characters)', v_key using errcode = '22023';
    end if;

    v_clean := v_clean || jsonb_build_object(v_key, v_text);
  end loop;

  -- 2d. merge over the current row and work out what actually changes
  v_new := jsonb_populate_record(v_old, v_clean);
  select coalesce(array_agg(c order by c), '{}') into v_changed
    from unnest(c_editable) c
   where (to_jsonb(v_new) -> c) is distinct from (to_jsonb(v_old) -> c);

  if coalesce(array_length(v_changed, 1), 0) = 0 and not coalesce(p_release_protection, false) then
    return jsonb_build_object('updated', false, 'changed', '[]'::jsonb, 'action_id', null,
                              'trademark', to_jsonb(v_old) - 'search_vector');
  end if;

  -- 2e. duplicate identifier guard (friendlier than the unique index error)
  if 'serial_number' = any (v_changed) or 'official_gazette_number' = any (v_changed) then
    select t.id, t.serial_number, t.official_gazette_number, t.mark_name into v_dup
      from public.trademarks t
     where t.official_gazette_number = v_new.official_gazette_number
       and t.serial_number = v_new.serial_number
       and t.id <> p_id
     limit 1;
    if found then
      raise exception 'Another record (%) already uses serial number % in gazette %',
        coalesce(v_dup.mark_name, v_dup.id::text), v_new.serial_number, v_new.official_gazette_number
        using errcode = 'PT409', hint = 'duplicate',
              detail = jsonb_build_object('id', v_dup.id, 'serial_number', v_dup.serial_number,
                                          'official_gazette_number', v_dup.official_gazette_number,
                                          'mark_name', v_dup.mark_name)::text;
    end if;
  end if;

  foreach v_key in array v_changed loop
    v_before := v_before || jsonb_build_object(v_key, to_jsonb(v_old) -> v_key);
    v_after  := v_after  || jsonb_build_object(v_key, to_jsonb(v_new) -> v_key);
  end loop;

  -- import protection: previously protected columns (unless released) + the
  -- Excel-managed columns changed now
  v_protect := (
    select coalesce(array_agg(distinct c order by c), '{}')
      from unnest(
             (case when coalesce(p_release_protection, false) then '{}'::text[] else coalesce(v_old.manual_edit_fields, '{}') end)
             || (select coalesce(array_agg(x), '{}') from unnest(v_changed) x where x = any (c_import_cols))
           ) c);

  -- 2f. the update — only the whitelisted columns; provenance stays as it is
  begin
    update public.trademarks t set
      record_number              = v_new.record_number,
      serial_number              = v_new.serial_number,
      mark_name                  = v_new.mark_name,
      mark_print                 = v_new.mark_print,
      applicant_name             = v_new.applicant_name,
      applicant_address          = v_new.applicant_address,
      trademark_class            = v_new.trademark_class,
      goods_and_services         = v_new.goods_and_services,
      application_type           = v_new.application_type,
      attorney_or_representative = v_new.attorney_or_representative,
      publication_date           = v_new.publication_date,
      objection_deadline         = v_new.objection_deadline,
      official_gazette_number    = v_new.official_gazette_number,
      registration_number        = v_new.registration_number,
      application_number         = v_new.application_number,
      new_address                = v_new.new_address,
      old_address                = v_new.old_address,
      new_owner                  = v_new.new_owner,
      old_owner                  = v_new.old_owner,
      source_page                = v_new.source_page,
      review_note                = v_new.review_note,
      review_comment             = v_new.review_comment,
      review_status              = v_new.review_status,
      is_published               = v_new.is_published,
      reviewed_by        = case when 'review_status' = any (v_changed) then auth.uid() else t.reviewed_by end,
      reviewed_at        = case when 'review_status' = any (v_changed) then now()      else t.reviewed_at end,
      manual_edit_fields = v_protect,
      manual_edited_at   = case when coalesce(array_length(v_changed, 1), 0) > 0 then now()      else t.manual_edited_at end,
      manual_edited_by   = case when coalesce(array_length(v_changed, 1), 0) > 0 then auth.uid() else t.manual_edited_by end
    where t.id = p_id;
  exception when unique_violation then
    raise exception 'Another record already uses serial number % in gazette %',
      v_new.serial_number, v_new.official_gazette_number
      using errcode = 'PT409', hint = 'duplicate';
  end;

  -- 2g. keep the denormalised labels on the SAME image rows in step with the
  --     identifiers (no image row is created, deleted or re-pathed)
  if 'serial_number' = any (v_changed) or 'official_gazette_number' = any (v_changed) then
    update public.trademark_images i
       set serial_number  = v_new.serial_number,
           gazette_number = v_new.official_gazette_number
     where i.trademark_id = p_id
       and (i.serial_number is distinct from v_new.serial_number
            or i.gazette_number is distinct from v_new.official_gazette_number);
    get diagnostics v_n = row_count;
  else
    v_n := 0;
  end if;

  -- 2h. administrative action log (actor e-mail, reason, before/after values)
  v_action := public.admin_record_action(
    'trademarks.edit', 'trademark', array[p_id::text], array[v_new.serial_number], '{}', null, 1, 'success',
    jsonb_build_object(
      'changed', to_jsonb(v_changed),
      'before', v_before,
      'after', v_after,
      'reason', left(p_reason, 500),
      'protection_released', coalesce(p_release_protection, false),
      'protected_fields', to_jsonb(v_protect),
      'image_labels_updated', v_n));

  select to_jsonb(t) - 'search_vector' into v_result from public.trademarks t where t.id = p_id;
  return jsonb_build_object('updated', true, 'changed', to_jsonb(v_changed), 'action_id', v_action, 'trademark', v_result);
end $$;

comment on function public.admin_update_trademark(uuid, jsonb, timestamptz, text, boolean) is
  'Administrator edit of one trademark record by id. Whitelisted fields only; optimistic concurrency on updated_at (PT409/stale); duplicate (gazette, serial) guard (PT409/duplicate); audited via audit_logs + admin_actions.';

revoke all on function public.admin_update_trademark(uuid, jsonb, timestamptz, text, boolean) from public, anon;
grant execute on function public.admin_update_trademark(uuid, jsonb, timestamptz, text, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. admin_import_trademark_rows — identical to 0600 except that columns listed
--    in manual_edit_fields keep their TMistan value (reported as "preserved").
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
  v_preserved text[];
  n_ins int := 0;
  n_upd int := 0;
  n_skip int := 0;
  n_fail int := 0;
  n_preserved int := 0;
  n_preserved_rows int := 0;
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
    v_serial := null; v_id := null; v_changed := '{}'; v_preserved := '{}';
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
        -- Manual corrections made in TMistan win over re-imported Excel values.
        if coalesce(array_length(v_old.manual_edit_fields, 1), 0) > 0 then
          select coalesce(array_agg(c order by c), '{}') into v_preserved
            from unnest(v_old.manual_edit_fields) c
           where c <> 'serial_number'
             and (v_in ? c)
             and (v_in -> c) is distinct from (to_jsonb(v_old) -> c);
          v_in := v_in - v_old.manual_edit_fields;
          -- the matched serial itself is never rewritten by the import
          v_in := v_in || jsonb_build_object('serial_number', v_old.serial_number);
          if coalesce(array_length(v_preserved, 1), 0) > 0 then
            n_preserved := n_preserved + array_length(v_preserved, 1);
            n_preserved_rows := n_preserved_rows + 1;
          end if;
        end if;
        v_merged := jsonb_populate_record(v_old, v_in);
        select coalesce(array_agg(c), '{}') into v_changed
          from unnest(c_cols) c
         where c <> 'serial_number'
           and (to_jsonb(v_merged) -> c) is distinct from (to_jsonb(v_old) -> c);
        if coalesce(array_length(v_changed, 1), 0) = 0 then
          n_skip := n_skip + 1;
          if coalesce(array_length(v_preserved, 1), 0) > 0 then
            v_items := v_items || jsonb_build_object('item_ref', v_serial, 'status', 'skipped',
                         'trademark_id', v_old.id, 'serial', v_serial, 'source_row', r -> 'source_row',
                         'preserved', to_jsonb(v_preserved));
          end if;
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
                       'changed', to_jsonb(v_changed), 'preserved', to_jsonb(v_preserved));
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
    select p_job_id, x ->> 'item_ref', x ->> 'status',
           case when jsonb_array_length(coalesce(x -> 'preserved', '[]'::jsonb)) > 0
                then 'Manually corrected field(s) kept: ' || array_to_string(array(select jsonb_array_elements_text(x -> 'preserved')), ', ')
                else null end,
           (x - 'item_ref' - 'status')
      from jsonb_array_elements(v_items) x;
  end if;
  if n_fail > 0 then
    insert into public.import_job_items (job_id, item_ref, status, message, payload)
    select p_job_id,
           coalesce(x ->> 'serial', 'row ' || coalesce(x ->> 'source_row', '?')),
           'failed', x ->> 'message', x
      from jsonb_array_elements(v_results) x;
  end if;
  return jsonb_build_object('inserted', n_ins, 'updated', n_upd, 'skipped', n_skip, 'failed', n_fail,
                            'preserved', n_preserved, 'preserved_rows', n_preserved_rows, 'results', v_results);
end $$;

commit;

-- post-checks -------------------------------------------------------------
select 'provenance columns (expect 3)' as object,
       (select count(*)::text from information_schema.columns
         where table_schema = 'public' and table_name = 'trademarks'
           and column_name in ('manual_edit_fields','manual_edited_at','manual_edited_by')) as value
union all select 'admin_update_trademark present (expect 1)',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'admin_update_trademark')
union all select 'admin_update_trademark callable by anon (must be 0)',
       (select count(*)::text from information_schema.routine_privileges
         where specific_schema = 'public' and routine_name = 'admin_update_trademark' and grantee in ('anon', 'PUBLIC'))
union all select 'manually corrected records so far (0 right after applying)',
       (select count(*)::text from public.trademarks where manual_edit_fields is not null and cardinality(manual_edit_fields) > 0)
union all select 'image rows (unchanged)', count(*)::text from public.trademark_images
union all select 'trademarks (unchanged)', count(*)::text from public.trademarks;
