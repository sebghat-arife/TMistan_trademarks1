-- ============================================================================
-- TMistan — APPLY MIGRATION 0400 (Admin Import Center)
--
-- Paste this whole file into the Supabase SQL Editor and click RUN once.
-- Generated from supabase/migrations/20260905000400_admin_import.sql by
-- scripts/build_apply_all.py — do not edit by hand, edit the migration.
--
-- Prerequisite: APPLY_ALL.sql (migrations 0100–0300) has already been run.
--
-- Safe by construction:
--   • only ADDs functions, two indexes and Storage policies
--   • never drops, truncates, re-keys or rewrites public.trademarks rows
--   • idempotent — running it twice is harmless
--
-- Read the "Messages" tab after running:
--   • WARNING "trademarks_serial_number_key NOT created" → duplicated serial
--     numbers exist; fix them and re-run (imports still work, but idempotency
--     then relies on gazette+serial).
--   • NOTICE  "Could not create Storage policy …" → create the four policies
--     in Dashboard → Storage → Policies (bucket trademark-images) as printed.
-- ============================================================================
begin;

-- ############################################################################
-- 20260905000400_admin_import.sql
-- ############################################################################
-- ============================================================================
-- 0400  ADMIN IMPORT CENTER — browser-driven imports with no application server
--
--  The public web app is a static site (Render), so there is no trusted
--  backend process. Every privileged import step therefore runs INSIDE the
--  database as a SECURITY DEFINER function that first checks public.is_admin()
--  (the caller's JWT subject must have a row in public.user_roles). The browser
--  only ever holds the publishable key + the administrator's own session.
--
--     admin_create_import_job         open a job (import_jobs row)
--     admin_import_trademark_rows     idempotent batch upsert keyed by serial_number
--     admin_resolve_serials           image filename (serial) → trademark
--     admin_register_images           link uploaded Storage objects (trademark_images)
--     admin_add_import_items          per-item report rows (unmatched / invalid / …)
--     admin_finish_import_job         close a job with a summary
--     admin_trademarks_without_images report: trademarks that still have no image
--
--  Additive and idempotent: only creates functions, one unique index (guarded),
--  one expression index and Storage policies. Never drops or rewrites rows.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. serial_number is the stable identifier used for idempotent imports and
--    for image matching, so it must be unique on its own. The index is only
--    created when the current data satisfies it (otherwise a WARNING tells the
--    operator which serials collide; the composite gazette+serial key stays).
-- ---------------------------------------------------------------------------
do $$
declare
  v_dups int;
  v_sample text;
begin
  select count(*), string_agg(serial_number, ', ' order by serial_number)
    into v_dups, v_sample
    from (select serial_number from public.trademarks group by serial_number having count(*) > 1 limit 10) d;
  if coalesce(v_dups, 0) = 0 then
    if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'trademarks_serial_number_key') then
      execute 'create unique index trademarks_serial_number_key on public.trademarks (serial_number)';
    end if;
  else
    raise warning 'trademarks_serial_number_key NOT created: duplicated serial numbers exist (%). Fix them and re-run this migration.', v_sample;
  end if;
end $$;

-- Canonical numeric form of a serial ("1011-002", "1011_2", "۱۰۱۱-۰۰۲" → "1011-2").
-- Used only as the LAST matching tier for image filenames; stored serials are
-- never altered.
create or replace function public.serial_canonical(p text)
returns text
language sql immutable parallel safe
as $$
  select case
    when m is null then null
    else coalesce(nullif(ltrim(m[1], '0'), ''), '0') || '-' || coalesce(nullif(ltrim(m[2], '0'), ''), '0')
  end
  from (
    select regexp_match(
             translate(coalesce(p, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
             '^\D*(\d+)\D+(\d+)\s*$') as m
  ) x;
$$;

comment on function public.serial_canonical(text) is
  'gazette-number pair of a serial with leading zeros and separators removed; matching aid only.';

create index if not exists trademarks_serial_canonical_idx
  on public.trademarks (public.serial_canonical(serial_number));

-- ---------------------------------------------------------------------------
-- 2. Guard used by every admin function
-- ---------------------------------------------------------------------------
create or replace function public.admin_assert()
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator role required'
      using errcode = '42501',
            hint = 'Sign in with an account that has an admin/editor row in public.user_roles.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Import jobs
-- ---------------------------------------------------------------------------
drop function if exists public.admin_finish_import_job(uuid, text, jsonb, text, int);

create or replace function public.admin_create_import_job(
  p_job_type   text,
  p_filename   text,
  p_total_rows int   default 0,
  p_summary    jsonb default '{}'::jsonb
)
returns public.import_jobs
language plpgsql security definer set search_path = public as $$
declare
  j public.import_jobs;
begin
  perform public.admin_assert();
  if p_job_type not in ('excel', 'images') then
    raise exception 'job_type must be excel or images' using errcode = '22023';
  end if;
  insert into public.import_jobs (job_type, filename, status, started_at, total_rows, summary, created_by)
  values (p_job_type,
          left(coalesce(p_filename, ''), 300),
          'processing',
          now(),
          greatest(coalesce(p_total_rows, 0), 0),
          coalesce(p_summary, '{}'::jsonb) || jsonb_build_object('source', 'import_center'),
          auth.uid())
  returning * into j;
  return j;
end $$;

create or replace function public.admin_finish_import_job(
  p_job_id          uuid,
  p_status          text,
  p_summary         jsonb default null,
  p_error_message   text  default null,
  p_total_rows      int   default null,
  p_failed_rows_add int   default 0      -- rows/files rejected client-side before upload
)
returns public.import_jobs
language plpgsql security definer set search_path = public as $$
declare
  j public.import_jobs;
begin
  perform public.admin_assert();
  if p_status not in ('completed', 'completed_with_warnings', 'failed') then
    raise exception 'status must be completed, completed_with_warnings or failed' using errcode = '22023';
  end if;
  update public.import_jobs
     set status        = p_status,
         completed_at  = now(),
         started_at    = coalesce(started_at, now()),
         total_rows    = coalesce(p_total_rows, total_rows),
         failed_rows   = failed_rows + greatest(coalesce(p_failed_rows_add, 0), 0),
         error_message = left(p_error_message, 2000),
         summary       = summary || coalesce(p_summary, '{}'::jsonb)
   where id = p_job_id
  returning * into j;
  if not found then
    raise exception 'Unknown import job %', p_job_id using errcode = '22023';
  end if;
  return j;
end $$;

-- Per-item report rows (unmatched images, invalid files, duplicates, failed rows …)
create or replace function public.admin_add_import_items(p_job_id uuid, p_items jsonb)
returns int
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  perform public.admin_assert();
  if not exists (select 1 from public.import_jobs where id = p_job_id) then
    raise exception 'Unknown import job %', p_job_id using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 5000 then
    raise exception 'At most 5000 items per call' using errcode = '22023';
  end if;
  insert into public.import_job_items (job_id, item_ref, status, message, payload)
  select p_job_id,
         left(coalesce(x ->> 'item_ref', ''), 500),
         case coalesce(x ->> 'status', '')
           when 'inserted'  then 'inserted'
           when 'updated'   then 'updated'
           when 'skipped'   then 'skipped'
           when 'duplicate' then 'skipped'
           when 'unchanged' then 'skipped'
           when 'unmatched' then 'unmatched'
           when 'ambiguous' then 'ambiguous'
           else 'failed'                     -- failed | invalid | anything unknown
         end,
         left(x ->> 'message', 2000),
         (x - 'item_ref' - 'status' - 'message')
    from jsonb_array_elements(p_items) x;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Trademark rows — idempotent upsert keyed by serial_number
--
--  * Only whitelisted columns are written; keys absent from a row keep their
--    current value, keys present with null clear the column (the spreadsheet
--    is the source of truth for the columns it contains).
--  * A row whose merged values equal the stored row is counted as "skipped"
--    (unchanged) and is not touched, so re-importing the same file is a no-op.
--  * official_gazette_number falls back to the numeric prefix of the serial
--    ("1011-002" → "1011") when the file has no gazette column.
--  * Every row is processed in its own sub-transaction: one bad row never
--    aborts the batch; it is reported back and stored in import_job_items.
-- ---------------------------------------------------------------------------
create or replace function public.admin_import_trademark_rows(p_job_id uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c_cols constant text[] := array[
    'record_number','serial_number','mark_name','mark_print','applicant_name','applicant_address',
    'trademark_class','goods_and_services','application_type','attorney_or_representative',
    'publication_date','objection_deadline','official_gazette_number','new_address','old_address',
    'new_owner','old_owner','source_page','review_note','source_file','source_sheet','source_row'];
  r         jsonb;
  k         text;
  v_in      jsonb;
  v_serial  text;
  v_gazette text;
  v_old     public.trademarks;
  v_merged  public.trademarks;
  n_ins int := 0;
  n_upd int := 0;
  n_skip int := 0;
  n_fail int := 0;
  v_results jsonb := '[]'::jsonb;
begin
  perform public.admin_assert();
  if not exists (select 1 from public.import_jobs where id = p_job_id) then
    raise exception 'Unknown import job %', p_job_id using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 1000 then
    raise exception 'At most 1000 rows per call' using errcode = '22023';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    v_serial := null;
    begin
      -- whitelist + trim; empty strings become NULL
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
        if row(v_merged.record_number, v_merged.mark_name, v_merged.mark_print, v_merged.applicant_name,
               v_merged.applicant_address, v_merged.trademark_class, v_merged.goods_and_services,
               v_merged.application_type, v_merged.attorney_or_representative, v_merged.publication_date,
               v_merged.objection_deadline, v_merged.official_gazette_number, v_merged.new_address,
               v_merged.old_address, v_merged.new_owner, v_merged.old_owner, v_merged.source_page,
               v_merged.review_note, v_merged.source_file, v_merged.source_sheet, v_merged.source_row)
           is not distinct from
           row(v_old.record_number, v_old.mark_name, v_old.mark_print, v_old.applicant_name,
               v_old.applicant_address, v_old.trademark_class, v_old.goods_and_services,
               v_old.application_type, v_old.attorney_or_representative, v_old.publication_date,
               v_old.objection_deadline, v_old.official_gazette_number, v_old.new_address,
               v_old.old_address, v_old.new_owner, v_old.old_owner, v_old.source_page,
               v_old.review_note, v_old.source_file, v_old.source_sheet, v_old.source_row)
        then
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
        end if;
      else
        v_merged := jsonb_populate_record(null::public.trademarks, v_in);
        insert into public.trademarks (
          record_number, serial_number, mark_name, mark_print, applicant_name, applicant_address,
          trademark_class, goods_and_services, application_type, attorney_or_representative,
          publication_date, objection_deadline, official_gazette_number, new_address, old_address,
          new_owner, old_owner, source_page, review_note, source_file, source_sheet, source_row,
          import_job_id)
        values (
          v_merged.record_number, v_merged.serial_number, v_merged.mark_name, v_merged.mark_print,
          v_merged.applicant_name, v_merged.applicant_address, v_merged.trademark_class,
          v_merged.goods_and_services, v_merged.application_type, v_merged.attorney_or_representative,
          v_merged.publication_date, v_merged.objection_deadline, v_merged.official_gazette_number,
          v_merged.new_address, v_merged.old_address, v_merged.new_owner, v_merged.old_owner,
          v_merged.source_page, v_merged.review_note, v_merged.source_file, v_merged.source_sheet,
          v_merged.source_row, p_job_id);
        n_ins := n_ins + 1;
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

  if n_fail > 0 then
    insert into public.import_job_items (job_id, item_ref, status, message, payload)
    select p_job_id,
           coalesce(x ->> 'serial', 'row ' || coalesce(x ->> 'source_row', '?')),
           'failed', x ->> 'message', x
      from jsonb_array_elements(v_results) x;
  end if;

  return jsonb_build_object('inserted', n_ins, 'updated', n_upd, 'skipped', n_skip, 'failed', n_fail, 'results', v_results);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Image matching: filename-derived serial → trademark
--    Tiers (deterministic, reported in `method`):
--      serial_exact       stored serial equals the trimmed filename stem
--      serial_normalized  equal after normalize_text (case, spaces, dashes/underscores, digits)
--      serial_numeric     equal gazette-number pair ("1011-2" ≡ "1011-002")
--    More than one trademark at the best tier → 'ambiguous' (never guessed).
-- ---------------------------------------------------------------------------
create or replace function public.admin_resolve_serials(p_serials text[])
returns table (
  input          text,
  trademark_id   uuid,
  serial_number  text,
  gazette_number text,
  mark_name      text,
  method         text,
  candidates     int
)
language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_assert();
  if p_serials is null or array_length(p_serials, 1) is null then
    return;
  end if;
  if array_length(p_serials, 1) > 2000 then
    raise exception 'At most 2000 serials per call' using errcode = '22023';
  end if;

  return query
  with inp as (
    select distinct btrim(s) as input from unnest(p_serials) s where nullif(btrim(s), '') is not null
  ),
  keyed as (
    select i.input, public.normalize_text(i.input) as norm, public.serial_canonical(i.input) as canon from inp i
  ),
  hits as (
    select k.input, t.id, t.serial_number, t.official_gazette_number, t.mark_name,
           case when t.serial_number = k.input then 1
                when t.serial_number_normalized = k.norm then 2
                else 3 end as tier
      from keyed k
      join public.trademarks t
        on t.serial_number = k.input
        or (k.norm is not null and t.serial_number_normalized = k.norm)
        or (k.canon is not null and public.serial_canonical(t.serial_number) = k.canon)
  ),
  best as (
    select h.input, min(h.tier) as tier from hits h group by h.input
  ),
  ranked as (
    select h.*, count(*) over (partition by h.input) as n
      from hits h join best b on b.input = h.input and b.tier = h.tier
  )
  select k.input,
         case when r.n = 1 then r.id end,
         case when r.n = 1 then r.serial_number end,
         case when r.n = 1 then r.official_gazette_number end,
         case when r.n = 1 then r.mark_name end,
         case when r.n is null then 'unmatched'
              when r.n > 1 then 'ambiguous'
              when r.tier = 1 then 'serial_exact'
              when r.tier = 2 then 'serial_normalized'
              else 'serial_numeric' end,
         coalesce(r.n, 0)::int
    from keyed k
    left join (select distinct on (rk.input) rk.* from ranked rk order by rk.input, rk.serial_number) r on r.input = k.input;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Link uploaded Storage objects to trademarks (metadata only).
--    Idempotent on (storage_bucket, storage_path); identical bytes re-uploaded
--    to the same path are 'unchanged'. A new logo for the same trademark under
--    a different path (e.g. .png replacing .jpg) supersedes the older
--    filename-matched logo; the superseded object paths are returned so the
--    caller can remove them from Storage.
-- ---------------------------------------------------------------------------
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
  if not exists (select 1 from public.import_jobs where id = p_job_id) then
    raise exception 'Unknown import job %', p_job_id using errcode = '22023';
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
        -- keep metadata fresh but do not count as a change
        update public.trademark_images set
          thumbnail_path = coalesce(nullif(x ->> 'thumbnail_path', ''), thumbnail_path),
          width = coalesce((x ->> 'width')::int, width), height = coalesce((x ->> 'height')::int, height),
          byte_size = coalesce((x ->> 'byte_size')::bigint, byte_size),
          content_type = coalesce(nullif(x ->> 'content_type', ''), content_type),
          import_job_id = coalesce(import_job_id, p_job_id)
        where id = v_existing.id;
      else
        -- supersede older automatically matched images of the same trademark/type at other paths
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
          content_type, content_hash, sort_order, import_job_id)
        values (
          v_tm, v_type, 'matched', coalesce(nullif(x ->> 'match_method', ''), 'serial_filename'),
          v_bucket, v_path, nullif(x ->> 'thumbnail_path', ''),
          left(x ->> 'original_filename', 500), left(x ->> 'source_folder', 500),
          x ->> 'gazette_number', x ->> 'serial_number',
          (x ->> 'width')::int, (x ->> 'height')::int, (x ->> 'byte_size')::bigint,
          nullif(x ->> 'content_type', ''), v_hash, 0, p_job_id)
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
          review_note       = null;

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

-- ---------------------------------------------------------------------------
-- 7. Report: trademarks that still have no matched image
-- ---------------------------------------------------------------------------
create or replace function public.admin_trademarks_without_images(p_limit int default 1000, p_offset int default 0)
returns table (
  id                      uuid,
  serial_number           text,
  official_gazette_number text,
  mark_name               text,
  applicant_name          text,
  total_count             bigint
)
language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_assert();
  return query
  select t.id, t.serial_number, t.official_gazette_number, t.mark_name, t.applicant_name,
         count(*) over () as total_count
    from public.trademarks t
   where not exists (select 1 from public.trademark_images i where i.trademark_id = t.id and i.status = 'matched')
   order by public.gazette_sort_key(t.official_gazette_number) desc nulls last, t.serial_number
   limit greatest(least(coalesce(p_limit, 1000), 5000), 1)
  offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Privileges — callable by signed-in users only; every function re-checks
--    is_admin() itself, so a non-admin session gets SQLSTATE 42501 (HTTP 403).
-- ---------------------------------------------------------------------------
revoke all on function public.admin_assert()                                    from public, anon;
revoke all on function public.admin_create_import_job(text, text, int, jsonb)   from public, anon;
revoke all on function public.admin_finish_import_job(uuid, text, jsonb, text, int, int) from public, anon;
revoke all on function public.admin_add_import_items(uuid, jsonb)               from public, anon;
revoke all on function public.admin_import_trademark_rows(uuid, jsonb)          from public, anon;
revoke all on function public.admin_resolve_serials(text[])                     from public, anon;
revoke all on function public.admin_register_images(uuid, jsonb)                from public, anon;
revoke all on function public.admin_trademarks_without_images(int, int)         from public, anon;

grant execute on function
  public.admin_assert(),
  public.admin_create_import_job(text, text, int, jsonb),
  public.admin_finish_import_job(uuid, text, jsonb, text, int, int),
  public.admin_add_import_items(uuid, jsonb),
  public.admin_import_trademark_rows(uuid, jsonb),
  public.admin_resolve_serials(text[]),
  public.admin_register_images(uuid, jsonb),
  public.admin_trademarks_without_images(int, int)
  to authenticated;

grant execute on function public.serial_canonical(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. Storage: administrators may write objects of the public bucket
--    `trademark-images` from the browser (upload, upsert, replace). Anonymous
--    users keep read-only access to the public bucket and nothing else.
--
--    Policies on storage.objects can be created from the Supabase SQL editor
--    (the April-2025 restrictions only forbid ALTER/CREATE TABLE there). Each
--    statement is guarded: if this project's editor role lacks the privilege,
--    a NOTICE tells you to add the same four policies in
--    Dashboard → Storage → Policies (bucket trademark-images) instead.
-- ---------------------------------------------------------------------------
do $$
declare
  p record;
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage.objects not present (local stack) — Storage policies skipped';
    return;
  end if;
  for p in
    select * from (values
      ('tmistan admin select trademark images', 'select',
       'using (bucket_id = ''trademark-images'' and public.is_admin())'),
      ('tmistan admin insert trademark images', 'insert',
       'with check (bucket_id = ''trademark-images'' and public.is_admin())'),
      ('tmistan admin update trademark images', 'update',
       'using (bucket_id = ''trademark-images'' and public.is_admin()) with check (bucket_id = ''trademark-images'' and public.is_admin())'),
      ('tmistan admin delete trademark images', 'delete',
       'using (bucket_id = ''trademark-images'' and public.is_admin())')
    ) as v(name, cmd, clause)
  loop
    begin
      if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = p.name) then
        execute format('drop policy %I on storage.objects', p.name);
      end if;
      execute format('create policy %I on storage.objects for %s to authenticated %s', p.name, p.cmd, p.clause);
    exception when insufficient_privilege then
      raise notice 'Could not create Storage policy "%" here (%). Create it in Dashboard → Storage → Policies: FOR % TO authenticated %',
        p.name, sqlerrm, upper(p.cmd), p.clause;
    end;
  end loop;
end $$;

-- Let PostgREST pick up the new functions immediately.
notify pgrst, 'reload schema';

commit;

-- post-checks -------------------------------------------------------------
select 'admin functions'      as object, count(*)::text as value from pg_proc where proname like 'admin\_%'
union all select 'serial unique index', (select count(*)::text from pg_indexes where indexname = 'trademarks_serial_number_key')
union all select 'storage policies',    (select count(*)::text from pg_policies where schemaname = 'storage' and policyname like 'tmistan admin%')
union all select 'trademarks',          count(*)::text from public.trademarks;
