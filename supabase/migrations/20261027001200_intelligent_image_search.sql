-- ============================================================================
-- 1200  INTELLIGENT IMAGE SEARCH — OCR text + CLIP embeddings + hybrid ranking
--
--  Upgrades "Search by Image" from the browser-only perceptual descriptor
--  (migration 0500, kept as a near-duplicate signal and as the offline
--  fallback) to a multimodal retrieval:
--
--     text    recognised words of the query image (OCR in services/vision)
--             matched against mark names, printed marks and the OCR text of
--             the stored images: exact, normalised, substring, trigram fuzzy,
--             edit distance, optional phonetic (fuzzystrmatch) and
--             conservative transliteration variants
--     visual  CLIP ViT-B/32 embeddings (512-d, pgvector cosine) of the stored
--             images — shapes, symbols, layout, overall appearance
--     dup     the existing 369-d descriptor (near-identical scans)
--
--  Objects (ADDITIVE and idempotent — nothing dropped, renamed or rewritten;
--  no trademark / image row or Storage object is touched):
--
--     trademark_image_analysis          one row per analysed image: OCR words,
--                                       normalised text, embedding, status,
--                                       model version, error — RLS on, no
--                                       public policies (functions only)
--     text_match(q, field)              0..1 similarity of one term to one field + kind
--     phonetic_key(text)                dmetaphone when fuzzystrmatch exists
--     hybrid_image_search_status()      PUBLIC  counts only (is the index usable?)
--     search_trademarks_hybrid(...)     PUBLIC  ranked candidates with separate
--                                               text / visual / combined scores,
--                                               match types and reasons
--     admin_image_analysis_status       ADMIN   totals, indexed, failed, pending
--     admin_image_analysis_pending      ADMIN   next images to analyse (resumable)
--     admin_upsert_image_analysis       ADMIN   store results (idempotent upsert)
--
--  The uploaded query image never reaches the database — only its words and
--  vectors do, and nothing about a query is stored. Scores are computational
--  indicators for research, never a legal determination of confusion.
-- ============================================================================

create schema if not exists extensions;
create extension if not exists vector with schema extensions;
do $$
begin
  create extension if not exists fuzzystrmatch with schema extensions;
exception when others then
  raise notice 'fuzzystrmatch not available (%): phonetic matching disabled', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Storage
-- ---------------------------------------------------------------------------
create table if not exists public.trademark_image_analysis (
  image_id            uuid primary key references public.trademark_images (id) on delete cascade,
  trademark_id        uuid not null references public.trademarks (id) on delete cascade,
  model_version       text not null,
  status              text not null check (status in ('indexed', 'failed')),
  ocr_text            text,
  ocr_text_normalized text generated always as (public.normalize_text(ocr_text)) stored,
  ocr_confidence      real,
  ocr_words           jsonb,
  ocr_scripts         text[],
  embedding           extensions.vector(512),
  warnings            text[],
  error               text,
  duration_ms         int,
  attempts            int not null default 1,
  indexed_at          timestamptz not null default now()
);
comment on table public.trademark_image_analysis is
  'OCR text + CLIP embedding per trademark image (intelligent image search). One row per image, versioned by model.';

create index if not exists trademark_image_analysis_trademark_idx on public.trademark_image_analysis (trademark_id);
create index if not exists trademark_image_analysis_model_status_idx on public.trademark_image_analysis (model_version, status);
create index if not exists trademark_image_analysis_ocr_trgm_idx
  on public.trademark_image_analysis using gin (ocr_text_normalized extensions.gin_trgm_ops);
create index if not exists trademark_image_analysis_embedding_hnsw
  on public.trademark_image_analysis using hnsw (embedding extensions.vector_cosine_ops);

alter table public.trademark_image_analysis enable row level security;
revoke all on table public.trademark_image_analysis from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Text similarity helpers
-- ---------------------------------------------------------------------------
create or replace function public.phonetic_key(p text)
returns text
language plpgsql immutable parallel safe
set search_path = public, extensions
as $$
begin
  if p is null or p !~ '^[a-z]+$' then return null; end if;
  if to_regprocedure('extensions.dmetaphone(text)') is null then return null; end if;
  return nullif(extensions.dmetaphone(p), '');
end $$;

-- 0..1 — how well one normalised query term matches one normalised field, and
-- the kind of evidence: exact · substring · fuzzy (edit distance / trigram) · phonetic
drop function if exists public.text_match_score(text, text);
drop function if exists public.text_match_kind(text, text, double precision);
create or replace function public.text_match(q text, field text, out score double precision, out kind text)
language plpgsql immutable parallel safe
set search_path = public, extensions
as $$
declare
  tok   text;
  lev   double precision;
  s     double precision;
  ql    int := length(coalesce(q, ''));
  flat  text;
begin
  score := 0; kind := null;
  if q is null or field is null or ql < 2 or length(field) = 0 then return; end if;
  if field = q then score := 1; kind := 'exact'; return; end if;
  if (' ' || field || ' ') like ('% ' || q || ' %') then score := 0.97; kind := 'exact'; return; end if;   -- whole word
  flat := replace(field, ' ', '');
  if ql >= 4 and (position(q in field) > 0 or position(q in flat) > 0) then score := 0.88; kind := 'substring'; return; end if;
  if ql >= 5 and length(flat) >= 4 and position(flat in q) > 0 then score := 0.86; kind := 'substring'; return; end if;  -- OCR glued words
  for tok in select x from regexp_split_to_table(field, ' ') x where length(x) >= 2 loop
    -- edit distance (short words must share the first letter to count)
    if ql >= 3 and length(tok) >= 3 and q ~ '^[a-z0-9]+$' and tok ~ '^[a-z0-9]+$'
       and (ql > 5 or left(q, 1) = left(tok, 1)) then
      lev := 1 - extensions.levenshtein(left(q, 60), left(tok, 60))::double precision / greatest(ql, length(tok));
      if lev >= 0.7 then
        s := 0.6 + (lev - 0.7) * 1.1;                      -- 0.70 → 0.60 … 0.75 → 0.655 … 0.9 → 0.82
        if s > score then score := s; kind := 'fuzzy'; end if;
      end if;
    end if;
    s := extensions.similarity(q, tok) * 0.9;
    if s > score then score := s; kind := 'fuzzy'; end if;
    if ql >= 3 and length(tok) >= 3 and left(q, 1) = left(tok, 1)
       and public.phonetic_key(q) is not null and public.phonetic_key(q) = public.phonetic_key(tok) then
      if 0.74 > score then score := 0.74; kind := 'phonetic'; end if;
    end if;
    -- consonant skeleton (transliterations without short vowels: "smndr" ~ "samandar")
    if q ~ '^[a-z]+$' and tok ~ '^[a-z]+$' and length(regexp_replace(q, '[aeiouy]', '', 'g')) >= 4
       and regexp_replace(q, '[aeiouy]', '', 'g') = regexp_replace(tok, '[aeiouy]', '', 'g') then
      if 0.7 > score then score := 0.7; kind := 'fuzzy'; end if;
    end if;
  end loop;
  s := greatest(extensions.word_similarity(q, field) * 0.85, extensions.similarity(q, field) * 0.9);
  if s > score then score := s; kind := 'fuzzy'; end if;
  score := least(score, 0.96);
  if score = 0 then kind := null; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Public status
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
    select a.image_id, a.trademark_id, a.embedding is not null as has_vec, nullif(a.ocr_text_normalized, '') is not null as has_text
      from public.trademark_image_analysis a
      join public.trademarks t on t.id = a.trademark_id and t.is_published
     where a.status = 'indexed' and a.model_version = (select model from v)
  )
  select jsonb_build_object(
    'model_version',       (select model from v),
    'visual_available',    (select count(*) from f where has_vec) > 0,
    'text_available',      (select count(*) from f where has_text) > 0,
    'indexed_images',      (select count(*) from f),
    'images_with_text',    (select count(*) from f where has_text),
    'indexed_trademarks',  (select count(distinct trademark_id) from f),
    'descriptor_available',(select count(*) from public.trademark_image_features) > 0
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. Public hybrid search
--    p_embedding   512 CLIP floats (unit norm) or null
--    p_terms       words the user confirmed (OCR output, edited) or null
--    p_variants    lower-weight candidate spellings (transliterations) or null
--    p_descriptor  369-d descriptor of migration 0500 (near-duplicate signal) or null
--    p_model       embedding model version the query vector came from (pins the
--                  comparable index rows; default = the most populated version)
--    thresholds / weights are explicit so the client can show its settings
-- ---------------------------------------------------------------------------
drop function if exists public.search_trademarks_hybrid(double precision[], text[], text[], double precision[], int, int[], text, text, int, double precision, double precision, double precision, double precision, text);
create or replace function public.search_trademarks_hybrid(
  p_embedding          double precision[] default null,
  p_terms              text[]             default null,
  p_variants           text[]             default null,
  p_descriptor         double precision[] default null,
  p_descriptor_version int                default null,
  p_classes            int[]              default null,
  p_gazette            text               default null,
  p_application_type   text               default null,
  p_limit              int                default 24,
  p_min_text           double precision   default 0.42,
  p_min_visual         double precision   default 0.72,
  p_text_weight        double precision   default 0.55,
  p_visual_weight      double precision   default 0.45,
  p_model              text               default null
)
returns table (
  id                      uuid,
  serial_number           text,
  record_number           text,
  mark_name               text,
  applicant_name          text,
  applicant_address       text,
  trademark_class         text,
  class_numbers           int[],
  goods_and_services      text,
  application_type        text,
  publication_date        date,
  objection_deadline      date,
  official_gazette_number text,
  source_page             text,
  review_status           text,
  primary_image_bucket    text,
  primary_image_path      text,
  primary_thumbnail_path  text,
  rank                    real,
  total_count             bigint,
  text_score              double precision,
  visual_score            double precision,
  visual_raw              double precision,
  duplicate_score         double precision,
  combined_score          double precision,
  match_types             text[],
  reasons                 jsonb,
  matched_image_id        uuid,
  matched_text            text
)
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_q        extensions.vector;
  v_d        extensions.vector;
  v_terms    text[];
  v_variants text[];
  v_phrase   text;
  v_limit    int := least(greatest(coalesce(p_limit, 24), 1), 60);
  v_model    text;
  v_wt       double precision := least(greatest(coalesce(p_text_weight, 0.55), 0), 1);
  v_wv       double precision := least(greatest(coalesce(p_visual_weight, 0.45), 0), 1);
  v_min_t    double precision := least(greatest(coalesce(p_min_text, 0.42), 0.2), 1);
  v_min_v    double precision := least(greatest(coalesce(p_min_visual, 0.72), 0.5), 1);
begin
  if p_embedding is not null then
    if coalesce(array_length(p_embedding, 1), 0) <> 512 then
      raise exception 'The visual embedding must contain exactly 512 values' using errcode = '22023';
    end if;
    v_q := p_embedding::extensions.vector(512);
  end if;
  if p_descriptor is not null then
    if coalesce(array_length(p_descriptor, 1), 0) <> 369 or p_descriptor_version is null then
      raise exception 'The image descriptor must contain exactly 369 values and a version' using errcode = '22023';
    end if;
    v_d := p_descriptor::extensions.vector(369);
  end if;
  select array_agg(x) into v_terms
    from (select distinct public.normalize_text(t) as x
            from unnest(coalesce(p_terms, '{}'::text[])) with ordinality as u(t, o)
           where length(public.normalize_text(t)) >= 2 and o <= 12) s;
  select array_agg(x) into v_variants
    from (select distinct public.normalize_text(t) as x
            from unnest(coalesce(p_variants, '{}'::text[])) with ordinality as u(t, o)
           where length(public.normalize_text(t)) >= 2 and o <= 30) s;
  v_phrase := nullif(public.normalize_text(array_to_string(coalesce(p_terms, '{}'::text[]), ' ')), '');
  if v_phrase is not null and position(' ' in v_phrase) > 0 then
    v_terms := array_prepend(v_phrase, coalesce(v_terms, '{}'));
  end if;
  if v_q is null and v_d is null and coalesce(array_length(v_terms, 1), 0) = 0 and coalesce(array_length(v_variants, 1), 0) = 0 then
    raise exception 'Provide recognised text, an embedding or a descriptor' using errcode = '22023';
  end if;
  -- vectors are only comparable within one model version: the client pins the
  -- version its embedding came from; otherwise the most populated one is used
  v_model := nullif(btrim(coalesce(p_model, '')), '');
  if v_model is null then
    select a.model_version into v_model
      from public.trademark_image_analysis a where a.status = 'indexed'
     group by a.model_version order by count(*) desc limit 1;
  end if;

  return query
  with
  -- ---- text channel -------------------------------------------------------
  fields as (
    select t.id as tid, 'mark_name'::text as fld, t.mark_name_normalized as val, 1.0::double precision as w
      from public.trademarks t where t.is_published and t.mark_name_normalized is not null
    union all
    select t.id, 'mark_print', public.normalize_text(t.mark_print), 0.95
      from public.trademarks t where t.is_published and nullif(t.mark_print, '') is not null
    union all
    select a.trademark_id, 'ocr', a.ocr_text_normalized, 0.9
      from public.trademark_image_analysis a
      join public.trademarks t on t.id = a.trademark_id and t.is_published
     where a.status = 'indexed' and nullif(a.ocr_text_normalized, '') is not null
  ),
  text_hits as (
    select f.tid, f.fld, f.val, q.term, q.is_variant, m.kind,
           m.score * f.w * (case when q.is_variant then 0.85 else 1 end) as score
      from fields f
      cross join (select x as term, false as is_variant from unnest(coalesce(v_terms, '{}'::text[])) x
                  union all
                  select x, true from unnest(coalesce(v_variants, '{}'::text[])) x) q
      cross join lateral public.text_match(q.term, f.val) m
     where (coalesce(array_length(v_terms, 1), 0) + coalesce(array_length(v_variants, 1), 0)) > 0
       and m.score > 0
  ),
  text_best as (
    select distinct on (h.tid) h.tid, h.score, h.fld, h.val, h.term, h.is_variant, h.kind
      from text_hits h
     where h.score >= v_min_t
     order by h.tid, h.score desc
  ),
  -- ---- visual channel (CLIP) ----------------------------------------------
  vis_pool as (
    select a.image_id, a.trademark_id, 1 - (a.embedding operator(extensions.<=>) v_q) as sim
      from public.trademark_image_analysis a
     where v_q is not null and a.status = 'indexed' and a.embedding is not null and a.model_version = v_model
     order by a.embedding operator(extensions.<=>) v_q
     limit 200
  ),
  vis_best as (
    select distinct on (p.trademark_id) p.trademark_id, p.image_id, p.sim
      from vis_pool p
      join public.trademarks t on t.id = p.trademark_id and t.is_published
     where p.sim >= v_min_v
     order by p.trademark_id, p.sim desc
  ),
  -- ---- near-duplicate channel (0500 descriptor) ---------------------------
  dup_pool as (
    select f.image_id, f.trademark_id, 1 - (f.embedding operator(extensions.<=>) v_d) as sim
      from public.trademark_image_features f
     where v_d is not null and f.descriptor_version = p_descriptor_version
     order by f.embedding operator(extensions.<=>) v_d
     limit 80
  ),
  dup_best as (
    select distinct on (p.trademark_id) p.trademark_id, p.image_id, p.sim
      from dup_pool p
      join public.trademarks t on t.id = p.trademark_id and t.is_published
     where p.sim >= 0.80
     order by p.trademark_id, p.sim desc
  ),
  -- ---- merge --------------------------------------------------------------
  merged as (
    select coalesce(tb.tid, vb.trademark_id, db.trademark_id) as tid,
           coalesce(tb.score, 0)  as tscore,
           vb.sim                 as vraw,
           db.sim                 as draw,
           greatest(0, least(1, (coalesce(vb.sim, 0) - 0.5) / 0.5))  as vnorm,
           greatest(0, least(1, (coalesce(db.sim, 0) - 0.55) / 0.45)) as dnorm,
           tb.fld, tb.val, tb.term, tb.is_variant, tb.kind,
           coalesce(db.image_id, vb.image_id) as img
      from text_best tb
      full outer join vis_best vb on vb.trademark_id = tb.tid
      full outer join dup_best db on db.trademark_id = coalesce(tb.tid, vb.trademark_id)
  ),
  scored as (
    select m.*,
           least(1, v_wt * m.tscore + v_wv * greatest(m.vnorm, m.dnorm)
                    + case when m.tscore > 0 and greatest(m.vnorm, m.dnorm) > 0 then 0.08 else 0 end) as combined
      from merged m
  ),
  filtered as (
    select s.*, t.*
      from scored s
      join public.trademarks t on t.id = s.tid and t.is_published
     where (p_classes is null or coalesce(array_length(p_classes, 1), 0) = 0 or t.class_numbers && p_classes)
       and (nullif(btrim(coalesce(p_gazette, '')), '') is null or t.official_gazette_number = btrim(p_gazette))
       and (nullif(btrim(coalesce(p_application_type, '')), '') is null or t.application_type = p_application_type)
  )
  select f.id, f.serial_number, f.record_number, f.mark_name, f.applicant_name, f.applicant_address,
         f.trademark_class, f.class_numbers, f.goods_and_services, f.application_type,
         f.publication_date, f.objection_deadline, f.official_gazette_number, f.source_page, f.review_status,
         i.storage_bucket, i.storage_path, i.thumbnail_path,
         f.combined::real                         as rank,
         (select count(*) from filtered)          as total_count,
         round(f.tscore::numeric, 4)::double precision  as text_score,
         round(f.vnorm::numeric, 4)::double precision   as visual_score,
         round(coalesce(f.vraw, 0)::numeric, 4)::double precision as visual_raw,
         round(f.dnorm::numeric, 4)::double precision   as duplicate_score,
         round(f.combined::numeric, 4)::double precision as combined_score,
         array_remove(array[
           case when f.tscore > 0 and f.is_variant then 'variant'
                when f.tscore > 0 and f.kind = 'exact' then 'text_exact'
                when f.tscore > 0 and f.kind = 'phonetic' then 'phonetic'
                when f.tscore > 0 then 'text_fuzzy' end,
           case when f.tscore > 0 and f.fld = 'ocr' then 'ocr_text' end,
           case when f.dnorm >= 0.67 or coalesce(f.vraw, 0) >= 0.95 then 'near_duplicate'
                when coalesce(f.vraw, 0) >= 0.85 then 'visual_high'
                when coalesce(f.vraw, 0) >= v_min_v then 'visual' end
         ]::text[], null)                        as match_types,
         jsonb_strip_nulls(jsonb_build_object(
           'text', case when f.tscore > 0 then jsonb_build_object('term', f.term, 'field', f.fld, 'kind', f.kind,
                                                                   'variant', f.is_variant, 'matched', f.val, 'score', round(f.tscore::numeric, 3)) end,
           'visual', case when f.vraw is not null then jsonb_build_object('similarity', round(f.vraw::numeric, 3), 'image_id', f.img) end,
           'duplicate', case when f.draw is not null then jsonb_build_object('similarity', round(f.draw::numeric, 3)) end,
           'class_filter', case when p_classes is not null and coalesce(array_length(p_classes, 1), 0) > 0 then true end
         ))                                       as reasons,
         f.img                                    as matched_image_id,
         f.val                                    as matched_text
    from filtered f
    left join lateral (
      select im.storage_bucket, im.storage_path, im.thumbnail_path
        from public.trademark_images im
       where im.trademark_id = f.id and im.status = 'matched'
       order by (im.id = f.img) desc, im.sort_order, im.created_at
       limit 1
    ) i on true
   order by f.combined desc, f.tscore desc, f.vraw desc nulls last, f.serial_number
   limit v_limit;
end $$;

comment on function public.search_trademarks_hybrid is
  'Intelligent image search: merges OCR-text matching (exact/fuzzy/phonetic/transliteration), CLIP visual similarity and the 0500 near-duplicate descriptor; one row per published trademark with separate scores, match types and reasons.';

-- ---------------------------------------------------------------------------
-- 5. Administration: resumable indexing of the stored images
-- ---------------------------------------------------------------------------
create or replace function public.analysis_assert()
returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then return; end if;
  perform public.admin_assert();
end $$;
revoke all on function public.analysis_assert() from public, anon, authenticated;

create or replace function public.admin_image_analysis_status(p_model text)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_matched bigint; v_indexed bigint; v_text bigint; v_failed bigint; v_other bigint; v_last timestamptz;
begin
  perform public.analysis_assert();
  select count(*) into v_matched from public.trademark_images i where i.status = 'matched' and i.trademark_id is not null;
  select count(*) filter (where a.status = 'indexed'),
         count(*) filter (where a.status = 'indexed' and nullif(a.ocr_text_normalized, '') is not null),
         count(*) filter (where a.status = 'failed'),
         max(a.indexed_at)
    into v_indexed, v_text, v_failed, v_last
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
    'pending',         greatest(v_matched - v_indexed - v_failed, 0),
    'other_versions',  v_other,
    'last_indexed_at', v_last,
    'failures', coalesce((select jsonb_agg(jsonb_build_object('image_id', a.image_id, 'storage_path', i.storage_path, 'serial_number', i.serial_number,
                                                               'error', a.error, 'attempts', a.attempts, 'at', a.indexed_at) order by a.indexed_at desc)
                            from (select * from public.trademark_image_analysis x where x.model_version = p_model and x.status = 'failed'
                                   order by x.indexed_at desc limit 25) a
                            join public.trademark_images i on i.id = a.image_id), '[]'::jsonb)
  );
end $$;

create or replace function public.admin_image_analysis_pending(p_model text, p_limit int default 100, p_retry_failed boolean default false)
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
     and (a.image_id is null or (p_retry_failed and a.status = 'failed' and a.attempts < 5))
   order by (a.image_id is null) desc, i.storage_path
   limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_upsert_image_analysis(p_model text, p_items jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  x jsonb; v_img public.trademark_images%rowtype; v_vec extensions.vector; v_arr double precision[];
  v_status text; n_ok int := 0; n_fail int := 0; v_results jsonb := '[]'::jsonb; v_words jsonb; v_text text;
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
      if v_status not in ('indexed', 'failed') then raise exception 'status must be indexed or failed' using errcode = '22023'; end if;
      v_vec := null;
      if v_status = 'indexed' and x ? 'embedding' and jsonb_typeof(x -> 'embedding') = 'array' then
        select array_agg(e::double precision) into v_arr from jsonb_array_elements_text(x -> 'embedding') e;
        if coalesce(array_length(v_arr, 1), 0) <> 512 then raise exception 'Embedding must contain 512 values' using errcode = '22023'; end if;
        v_vec := v_arr::extensions.vector(512);
      end if;
      v_words := case when jsonb_typeof(x -> 'ocr_words') = 'array' then x -> 'ocr_words' else null end;
      v_text := left(nullif(btrim(coalesce(x ->> 'ocr_text', '')), ''), 2000);
      if v_status = 'indexed' and v_vec is null and v_text is null then
        raise exception 'An indexed row needs an embedding or OCR text' using errcode = '22023';
      end if;
      insert into public.trademark_image_analysis as a
        (image_id, trademark_id, model_version, status, ocr_text, ocr_confidence, ocr_words, ocr_scripts, embedding, warnings, error, duration_ms, attempts, indexed_at)
      values (v_img.id, v_img.trademark_id, p_model, v_status, v_text,
              nullif(x ->> 'ocr_confidence', '')::real, v_words,
              case when jsonb_typeof(x -> 'ocr_scripts') = 'array' then array(select jsonb_array_elements_text(x -> 'ocr_scripts')) end,
              v_vec,
              case when jsonb_typeof(x -> 'warnings') = 'array' then array(select jsonb_array_elements_text(x -> 'warnings')) end,
              left(x ->> 'error', 500), nullif(x ->> 'duration_ms', '')::int, 1, now())
      on conflict (image_id) do update
        set trademark_id = excluded.trademark_id, model_version = excluded.model_version, status = excluded.status,
            ocr_text = excluded.ocr_text, ocr_confidence = excluded.ocr_confidence, ocr_words = excluded.ocr_words,
            ocr_scripts = excluded.ocr_scripts, embedding = excluded.embedding, warnings = excluded.warnings,
            error = excluded.error, duration_ms = excluded.duration_ms,
            attempts = case when a.model_version = excluded.model_version then a.attempts + 1 else 1 end,
            indexed_at = now();
      if v_status = 'indexed' then n_ok := n_ok + 1; else n_fail := n_fail + 1; end if;
      v_results := v_results || jsonb_build_object('image_id', v_img.id, 'status', v_status, 'error', x ->> 'error');
    exception when others then
      n_fail := n_fail + 1;
      v_results := v_results || jsonb_build_object('image_id', x ->> 'image_id', 'status', 'failed', 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('model_version', p_model, 'indexed', n_ok, 'failed', n_fail, 'results', v_results);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Grants — public read-only functions for everyone, indexing for
--    administrators (checked inside) and the service role.
-- ---------------------------------------------------------------------------
revoke all on function public.text_match(text, text)                  from public;
revoke all on function public.phonetic_key(text)                      from public;
revoke all on function public.hybrid_image_search_status(text)        from public;
revoke all on function public.search_trademarks_hybrid(double precision[], text[], text[], double precision[], int, int[], text, text, int, double precision, double precision, double precision, double precision, text) from public;
revoke all on function public.admin_image_analysis_status(text)       from public, anon;
revoke all on function public.admin_image_analysis_pending(text, int, boolean) from public, anon;
revoke all on function public.admin_upsert_image_analysis(text, jsonb) from public, anon;

grant execute on function public.text_match(text, text)                  to anon, authenticated, service_role;
grant execute on function public.phonetic_key(text)                      to anon, authenticated, service_role;
grant execute on function public.hybrid_image_search_status(text)        to anon, authenticated, service_role;
grant execute on function public.search_trademarks_hybrid(double precision[], text[], text[], double precision[], int, int[], text, text, int, double precision, double precision, double precision, double precision, text) to anon, authenticated, service_role;
grant execute on function public.admin_image_analysis_status(text)       to authenticated, service_role;
grant execute on function public.admin_image_analysis_pending(text, int, boolean) to authenticated, service_role;
grant execute on function public.admin_upsert_image_analysis(text, jsonb) to authenticated, service_role;
