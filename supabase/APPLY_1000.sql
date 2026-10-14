-- ============================================================================
-- TMistan — APPLY MIGRATION 1000 (image re-upload fix: Storage cleanup guard)
--
-- Paste this whole file into the Supabase SQL Editor and click RUN once.
-- Generated from supabase/migrations/20261014001000_image_reupload_fix.sql by
-- scripts/build_apply_all.py — do not edit by hand, edit the migration.
--
-- Prerequisite: migration 0600 (APPLY_0600.sql) is in place — it created
-- storage_cleanup_queue and the functions re-defined here. 0700–0900 are NOT
-- required.
--
-- What it fixes: deleting an image only QUEUED the removal of its Storage
-- file; an image re-uploaded for the same serial number re-used that path, so
-- running the cleanup queue later deleted the NEW picture as well. From now on
--   • admin_register_images cancels a queued removal of any path it registers
--   • admin_storage_cleanup_list marks every queued path that is referenced
--     by a current image row as `skipped` before listing (never removable)
--   • admin_trademark_images_lookup lets the Import Center plan uploads
--     against the images a trademark already has
--   • queue entries that already point at a live image are marked `skipped`
--     once (one-off data fix of the queue table only — no trademark or image
--     row and no Storage object is touched)
--
-- Safe by construction — ADDITIVE ONLY:
--   • re-creates four admin functions (same names/signatures, same callers)
--   • adds one admin-only function and one internal helper (no API grant)
--   • touches no trademark, gazette, applicant or image row, no Storage object
--   • idempotent — running it twice is harmless
-- ============================================================================
begin;

-- ############################################################################
-- 20261014001000_image_reupload_fix.sql
-- ############################################################################
-- ============================================================================
-- 1000  IMAGE RE-UPLOAD FIX — the "delete an image, re-upload a corrected one
--       for the same serial number" workflow.
--
--  What went wrong (observed on the production project on 2026-10-14):
--
--    1. admin_delete_images / admin_delete_trademarks / admin_delete_import_job_records
--       delete the trademark_images rows and QUEUE their Storage objects for
--       removal (storage_cleanup_queue, run later from Admin → Orphaned Files).
--    2. The administrator re-uploads a corrected image for the same serial
--       number.  The Import Center stored it under the SAME object path
--       (<gazette>/<serial>.<ext>) and linked a NEW row to that path.
--    3. The queue still held that path.  Running the cleanup removed the
--       object although a live row now referenced it → the record lost its
--       image for good.  57 queued paths were in exactly that state when this
--       migration was written (none had been run yet).
--
--    Independently of the queue, the public CDN caches an object path for an
--    hour (Cache-Control: max-age=3600), so a new picture uploaded under the
--    SAME path kept showing the OLD picture — "the corrected image does not
--    appear".  The web app now stores replaced images under content-addressed
--    paths (<gazette>/<serial>-<sha256 prefix>.<ext>), which the database does
--    not need to know about; the guards below protect either naming scheme.
--
--  What this migration does — ADDITIVE and idempotent, no data is removed:
--
--    1. admin_cancel_storage_cleanup(paths, note)  (internal helper)
--       marks pending/failed queue entries for the given paths as 'skipped'.
--    2. admin_register_images — after linking an image, cancels any queued
--       removal of that object (and its thumbnail).
--    3. admin_storage_cleanup_list — never hands out a pending/failed entry
--       whose object is referenced by a current image row; such entries are
--       marked 'skipped' on the way out.  Running the queue can no longer
--       delete a live image.
--    4. admin_storage_cleanup_mark — keeps the note for 'skipped' entries.
--    5. admin_trademark_images_lookup(uuid[]) — existing images (path +
--       content hash) of a set of trademarks, so the Import Center recognises
--       identical bytes ("unchanged") and keeps their object path stable.
--    6. One-off repair of the queue: entries that point to a live object are
--       marked 'skipped' now.
--
--  Nothing in public.trademarks is touched.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Internal helper: cancel queued removals of paths that are in use again
-- ---------------------------------------------------------------------------
create or replace function public.admin_cancel_storage_cleanup(p_paths text[], p_note text default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  n int := 0;
begin
  update public.storage_cleanup_queue q
     set status     = 'skipped',
         last_error = left(coalesce(p_note, 'skipped: object is referenced by a current image row'), 1000),
         updated_at = now()
   where q.bucket = 'trademark-images'
     and q.status in ('pending', 'failed')
     and q.path = any (coalesce(p_paths, '{}'));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.admin_cancel_storage_cleanup(text[], text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. admin_register_images — identical to 0600 plus the queue cancellation
--    after every successfully linked image (both the "unchanged" and the
--    insert/replace branch).
-- ---------------------------------------------------------------------------
create or replace function public.admin_register_images(p_job_id uuid, p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  x          jsonb;
  v_tm       uuid;
  v_path     text;
  v_thumb    text;
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
      v_thumb  := nullif(x ->> 'thumbnail_path', '');
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
          thumbnail_path = coalesce(v_thumb, thumbnail_path),
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
          v_bucket, v_path, v_thumb,
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

      -- The object (and thumbnail) is in use (again): a removal queued by an
      -- earlier deletion of the same path must never run.
      perform public.admin_cancel_storage_cleanup(
        array_remove(array[v_path, v_thumb], null),
        'skipped: object re-registered by import job ' || p_job_id::text);

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
revoke all on function public.admin_register_images(uuid, jsonb) from public, anon;
grant execute on function public.admin_register_images(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. admin_storage_cleanup_list — a queued removal whose object is referenced
--    by a current image row is marked 'skipped' and never returned as runnable.
--    (Same signature and return type as 0600; now plpgsql so it can repair
--    the queue while listing.)
-- ---------------------------------------------------------------------------
create or replace function public.admin_storage_cleanup_list(p_status text default 'pending', p_limit int default 500)
returns setof public.storage_cleanup_queue
language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_assert();
  update public.storage_cleanup_queue q
     set status     = 'skipped',
         last_error = 'skipped: object is referenced by a current image row',
         updated_at = now()
   where q.status in ('pending', 'failed')
     and exists (select 1 from public.trademark_images i
                  where i.storage_bucket = q.bucket
                    and (i.storage_path = q.path or i.thumbnail_path = q.path));
  return query
  select q.* from public.storage_cleanup_queue q
   where (p_status is null or p_status = 'all' or q.status = p_status)
   order by q.created_at
   limit least(greatest(coalesce(p_limit, 500), 1), 2000);
end $$;
revoke all on function public.admin_storage_cleanup_list(text, int) from public, anon;
grant execute on function public.admin_storage_cleanup_list(text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. admin_storage_cleanup_mark — keep the note for 'skipped' entries too
-- ---------------------------------------------------------------------------
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
         last_error = case when p_status in ('failed', 'skipped') then left(p_error, 1000) else null end,
         updated_at = now()
   where id = any (coalesce(p_ids, '{}'));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.admin_storage_cleanup_mark(bigint[], text, text) from public, anon;
grant execute on function public.admin_storage_cleanup_mark(bigint[], text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. admin_trademark_images_lookup — existing images of a set of trademarks
--    (lets the Import Center keep the object path of identical bytes).
-- ---------------------------------------------------------------------------
create or replace function public.admin_trademark_images_lookup(p_trademark_ids uuid[])
returns table (
  id uuid, trademark_id uuid, image_type text, status text, match_method text,
  storage_bucket text, storage_path text, thumbnail_path text, content_hash text)
language plpgsql security definer stable set search_path = public as $$
begin
  perform public.admin_assert();
  if coalesce(array_length(p_trademark_ids, 1), 0) > 1000 then
    raise exception 'At most 1000 trademarks per call' using errcode = '22023';
  end if;
  return query
  select i.id, i.trademark_id, i.image_type, i.status, i.match_method,
         i.storage_bucket, i.storage_path, i.thumbnail_path, i.content_hash
    from public.trademark_images i
   where i.trademark_id = any (coalesce(p_trademark_ids, '{}'))
   order by i.trademark_id, i.sort_order, i.created_at;
end $$;
revoke all on function public.admin_trademark_images_lookup(uuid[]) from public, anon;
grant execute on function public.admin_trademark_images_lookup(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. One-off repair: queued removals that point to a live object
-- ---------------------------------------------------------------------------
update public.storage_cleanup_queue q
   set status     = 'skipped',
       last_error = 'skipped by migration 1000: object is referenced by a current image row',
       updated_at = now()
 where q.status in ('pending', 'failed')
   and exists (select 1 from public.trademark_images i
                where i.storage_bucket = q.bucket
                  and (i.storage_path = q.path or i.thumbnail_path = q.path));

comment on function public.admin_storage_cleanup_list(text, int) is
  'Cleanup queue listing for administrators. Entries whose object is referenced by a current trademark_images row are marked skipped and are never runnable (migration 1000).';
comment on function public.admin_trademark_images_lookup(uuid[]) is
  'Existing trademark_images rows (path + content hash) for up to 1000 trademarks; used by the Import Center to recognise identical bytes before uploading.';

commit;

-- post-checks -------------------------------------------------------------
select 'functions (expect 5)' as object,
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('admin_register_images','admin_storage_cleanup_list','admin_storage_cleanup_mark',
               'admin_trademark_images_lookup','admin_cancel_storage_cleanup')) as value
union all select 'internal helper callable by anon/authenticated (must be 0)',
       (select count(*)::text from information_schema.routine_privileges
         where specific_schema = 'public' and routine_name = 'admin_cancel_storage_cleanup' and grantee in ('anon', 'authenticated', 'PUBLIC'))
union all select 'queue entries still pending that point at a live image (must be 0)',
       (select count(*)::text from public.storage_cleanup_queue q
         where q.status in ('pending', 'failed')
           and exists (select 1 from public.trademark_images i
                        where i.storage_bucket = q.bucket and (i.storage_path = q.path or i.thumbnail_path = q.path)))
union all select 'queue entries skipped by this migration',
       (select count(*)::text from public.storage_cleanup_queue where last_error like 'skipped by migration 1000:%')
union all select 'image rows (unchanged)', count(*)::text from public.trademark_images
union all select 'trademarks (unchanged)', count(*)::text from public.trademarks;
