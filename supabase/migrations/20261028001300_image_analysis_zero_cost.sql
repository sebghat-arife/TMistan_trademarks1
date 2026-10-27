-- ============================================================================
-- 1300 — Intelligent Search by Image without a paid vision service
--
-- Migration 1200 stored one analysis row per image (OCR text + optional
-- embedding) and expected a continuously running inference service to fill it.
-- The $0 design analyses images in the administrator's browser (Import Center)
-- or with the offline tools/image_index CLI, with text recognition only. This
-- migration adapts the 1200 objects for that — ADDITIVE and idempotent:
--
--   • status 'skipped' — the image was analysed and nothing readable was found
--     (symbol-only marks). It is no longer "pending", can be re-queued later.
--   • column engine — which recogniser produced the row (tesseract.js@… in the
--     browser, tesseract 5.x offline); model_version keeps identifying the
--     language models, so both indexers add up to one index.
--   • hybrid_image_search_status() additionally reports images_skipped,
--     analysed_images and matched_images (public, counts only).
--   • admin_image_analysis_status() reports skipped; pending excludes skipped.
--   • admin_image_analysis_pending() gains p_include_skipped (re-run symbol-only
--     images); the old 3-argument signature is replaced (PostgREST must see a
--     single function).
--   • admin_upsert_image_analysis() accepts status 'skipped' and 'engine'.
--
-- Requires 1200. Never drops a table, never deletes or rewrites a trademark,
-- image or analysis row, never touches Storage. Running it twice is harmless.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table: 'skipped' status + engine
-- ---------------------------------------------------------------------------
alter table public.trademark_image_analysis drop constraint if exists trademark_image_analysis_status_check;
alter table public.trademark_image_analysis
  add constraint trademark_image_analysis_status_check check (status in ('indexed', 'failed', 'skipped'));
alter table public.trademark_image_analysis add column if not exists engine text;
comment on column public.trademark_image_analysis.engine is
  'Recogniser that produced the row (e.g. tesseract.js@7.0.0 in the browser, tesseract 5.5.0 offline). model_version identifies the language models.';
comment on column public.trademark_image_analysis.status is
  'indexed = recognised text (and/or embedding) stored · skipped = analysed, nothing readable (symbol-only) · failed = error (see error/attempts)';

-- ---------------------------------------------------------------------------
-- 2. Public status (same signature as 1200, more counts)
-- ---------------------------------------------------------------------------
create or replace function public.hybrid_image_search_status(p_model text default null)
returns jsonb
language sql stable security definer
set search_path = public, extensions
as $$
  with v as (
    select coalesce(p_model, (select a.model_version from public.trademark_image_analysis a
                               where a.status = 'indexed' group by a.model_version order by count(*) desc limit 1)) as model
  ),
  f as (
    select a.image_id, a.trademark_id, a.status, a.embedding is not null as has_vec, nullif(a.ocr_text_normalized, '') is not null as has_text
      from public.trademark_image_analysis a
      join public.trademark_images i on i.id = a.image_id and i.status = 'matched'
      join public.trademarks t on t.id = a.trademark_id and t.is_published
     where a.status in ('indexed', 'skipped') and a.model_version = (select model from v)
  )
  select jsonb_build_object(
    'model_version',       (select model from v),
    'visual_available',    (select count(*) from f where status = 'indexed' and has_vec) > 0,
    'text_available',      (select count(*) from f where status = 'indexed' and has_text) > 0,
    'indexed_images',      (select count(*) from f where status = 'indexed'),
    'images_with_text',    (select count(*) from f where status = 'indexed' and has_text),
    'images_skipped',      (select count(*) from f where status = 'skipped'),
    'analysed_images',     (select count(*) from f),
    'indexed_trademarks',  (select count(distinct trademark_id) from f where status = 'indexed'),
    'matched_images',      (select count(*) from public.trademark_images i join public.trademarks t on t.id = i.trademark_id and t.is_published
                             where i.status = 'matched'),
    'descriptor_available',(select count(*) from public.trademark_image_features) > 0
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. Admin status with 'skipped'
-- ---------------------------------------------------------------------------
create or replace function public.admin_image_analysis_status(p_model text)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_matched bigint; v_indexed bigint; v_text bigint; v_failed bigint; v_skipped bigint; v_other bigint; v_last timestamptz;
begin
  perform public.analysis_assert();
  select count(*) into v_matched from public.trademark_images i where i.status = 'matched' and i.trademark_id is not null;
  select count(*) filter (where a.status = 'indexed'),
         count(*) filter (where a.status = 'indexed' and nullif(a.ocr_text_normalized, '') is not null),
         count(*) filter (where a.status = 'failed'),
         count(*) filter (where a.status = 'skipped'),
         max(a.indexed_at)
    into v_indexed, v_text, v_failed, v_skipped, v_last
    from public.trademark_image_analysis a
    join public.trademark_images i on i.id = a.image_id and i.status = 'matched'
   where a.model_version = p_model;
  select count(*) into v_other from public.trademark_image_analysis a where a.model_version <> p_model;
  return jsonb_build_object(
    'model_version',   p_model,
    'matched_images',  v_matched,
    'indexed',         v_indexed,
    'with_text',       v_text,
    'failed',          v_failed,
    'skipped',         v_skipped,
    'pending',         greatest(v_matched - v_indexed - v_failed - v_skipped, 0),
    'other_versions',  v_other,
    'last_indexed_at', v_last,
    'failures', coalesce((select jsonb_agg(jsonb_build_object('image_id', a.image_id, 'storage_path', i.storage_path, 'serial_number', i.serial_number,
                                                               'error', a.error, 'attempts', a.attempts, 'at', a.indexed_at) order by a.indexed_at desc)
                            from (select * from public.trademark_image_analysis x where x.model_version = p_model and x.status = 'failed'
                                   order by x.indexed_at desc limit 25) a
                            join public.trademark_images i on i.id = a.image_id), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- 4. Pending list: + p_include_skipped (replaces the 3-argument function)
-- ---------------------------------------------------------------------------
drop function if exists public.admin_image_analysis_pending(text, int, boolean);
create or replace function public.admin_image_analysis_pending(p_model text, p_limit int default 100, p_retry_failed boolean default false, p_include_skipped boolean default false)
returns table (id uuid, trademark_id uuid, storage_bucket text, storage_path text, serial_number text, content_type text, byte_size bigint)
language plpgsql stable security definer
set search_path = public, extensions
as $$
begin
  perform public.analysis_assert();
  if p_model is null then raise exception 'Model version is required' using errcode = '22023'; end if;
  return query
  select i.id, i.trademark_id, i.storage_bucket, i.storage_path, i.serial_number, i.content_type, i.byte_size
    from public.trademark_images i
    left join public.trademark_image_analysis a on a.image_id = i.id and a.model_version = p_model
   where i.status = 'matched' and i.trademark_id is not null
     and (a.image_id is null
          or (p_retry_failed and a.status = 'failed' and a.attempts < 5)
          or (p_include_skipped and a.status = 'skipped'))
   order by (a.image_id is null) desc, i.storage_path
   limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Upsert: status 'skipped', engine; text-only rows are the normal case
-- ---------------------------------------------------------------------------
create or replace function public.admin_upsert_image_analysis(p_model text, p_items jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  x jsonb; v_img public.trademark_images%rowtype; v_vec extensions.vector; v_arr double precision[];
  v_status text; n_ok int := 0; n_fail int := 0; n_skip int := 0; v_results jsonb := '[]'::jsonb; v_words jsonb; v_text text;
begin
  perform public.analysis_assert();
  if p_model is null then raise exception 'Model version is required' using errcode = '22023'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'p_items must be a JSON array' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'At most 200 items per call' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(p_items) loop
    begin
      select * into v_img from public.trademark_images i where i.id = (x ->> 'image_id')::uuid;
      if v_img.id is null then raise exception 'Image not found' using errcode = 'P0002'; end if;
      if v_img.trademark_id is null then raise exception 'Image is not linked to a trademark' using errcode = '22023'; end if;
      v_status := coalesce(x ->> 'status', 'indexed');
      if v_status not in ('indexed', 'failed', 'skipped') then raise exception 'status must be indexed, failed or skipped' using errcode = '22023'; end if;
      v_vec := null;
      if v_status = 'indexed' and x ? 'embedding' and jsonb_typeof(x -> 'embedding') = 'array' then
        select array_agg(e::double precision) into v_arr from jsonb_array_elements_text(x -> 'embedding') e;
        if coalesce(array_length(v_arr, 1), 0) <> 512 then raise exception 'Embedding must contain 512 values' using errcode = '22023'; end if;
        v_vec := v_arr::extensions.vector(512);
      end if;
      v_words := case when jsonb_typeof(x -> 'ocr_words') = 'array' then x -> 'ocr_words' else null end;
      v_text := left(nullif(btrim(coalesce(x ->> 'ocr_text', '')), ''), 2000);
      if v_status = 'indexed' and v_vec is null and v_text is null then
        raise exception 'An indexed row needs an embedding or OCR text (use status skipped when nothing was read)' using errcode = '22023';
      end if;
      if v_status = 'skipped' then v_text := null; v_words := null; v_vec := null; end if;
      insert into public.trademark_image_analysis as a
        (image_id, trademark_id, model_version, status, ocr_text, ocr_confidence, ocr_words, ocr_scripts, embedding, warnings, error, duration_ms, engine, attempts, indexed_at)
      values (v_img.id, v_img.trademark_id, p_model, v_status, v_text,
              nullif(x ->> 'ocr_confidence', '')::real, v_words,
              case when jsonb_typeof(x -> 'ocr_scripts') = 'array' then array(select jsonb_array_elements_text(x -> 'ocr_scripts')) end,
              v_vec,
              case when jsonb_typeof(x -> 'warnings') = 'array' then array(select jsonb_array_elements_text(x -> 'warnings')) end,
              left(x ->> 'error', 500), nullif(x ->> 'duration_ms', '')::int, left(nullif(x ->> 'engine', ''), 80), 1, now())
      on conflict (image_id) do update
        set trademark_id = excluded.trademark_id, model_version = excluded.model_version, status = excluded.status,
            ocr_text = excluded.ocr_text, ocr_confidence = excluded.ocr_confidence, ocr_words = excluded.ocr_words,
            ocr_scripts = excluded.ocr_scripts, embedding = excluded.embedding, warnings = excluded.warnings,
            error = excluded.error, duration_ms = excluded.duration_ms, engine = excluded.engine,
            attempts = case when a.model_version = excluded.model_version then a.attempts + 1 else 1 end,
            indexed_at = now();
      if v_status = 'indexed' then n_ok := n_ok + 1; elsif v_status = 'skipped' then n_skip := n_skip + 1; else n_fail := n_fail + 1; end if;
      v_results := v_results || jsonb_build_object('image_id', v_img.id, 'status', v_status, 'error', x ->> 'error');
    exception when others then
      n_fail := n_fail + 1;
      v_results := v_results || jsonb_build_object('image_id', x ->> 'image_id', 'status', 'failed', 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('model_version', p_model, 'indexed', n_ok, 'failed', n_fail, 'skipped', n_skip, 'results', v_results);
end $$;

comment on function public.admin_upsert_image_analysis is
  'Store browser/offline analysis results for matched images (≤ 200 per call). Administrators (admin_assert) or service role. Idempotent per image: a re-run updates the row and counts an attempt. status: indexed (text and/or embedding) · skipped (nothing readable) · failed.';

-- ---------------------------------------------------------------------------
-- 6. Grants (unchanged policy; the new pending signature needs its own grant)
-- ---------------------------------------------------------------------------
revoke all on function public.hybrid_image_search_status(text)                          from public;
revoke all on function public.admin_image_analysis_status(text)                         from public, anon;
revoke all on function public.admin_image_analysis_pending(text, int, boolean, boolean) from public, anon;
revoke all on function public.admin_upsert_image_analysis(text, jsonb)                  from public, anon;
grant execute on function public.hybrid_image_search_status(text)                          to anon, authenticated, service_role;
grant execute on function public.admin_image_analysis_status(text)                         to authenticated, service_role;
grant execute on function public.admin_image_analysis_pending(text, int, boolean, boolean) to authenticated, service_role;
grant execute on function public.admin_upsert_image_analysis(text, jsonb)                  to authenticated, service_role;

notify pgrst, 'reload schema';
