-- ============================================================================
-- 0500  SEARCH BY IMAGE — visual-similarity index for published trademark images
--
--  The browser computes a compact visual descriptor of an image (see
--  web/src/lib/imageSearch/descriptor.ts: perceptual hash + low-frequency DCT +
--  stroke-orientation + colour + geometry, 369 floats, L2-normalised). This
--  migration stores those vectors with pgvector and exposes:
--
--     search_trademarks_by_image     PUBLIC  nearest published trademarks by cosine similarity
--     image_search_status            PUBLIC  is the index usable? (counts only)
--     admin_image_index_status       ADMIN   indexed / stale / missing counts
--     admin_images_missing_features  ADMIN   images that still need a descriptor
--     admin_upsert_image_features    ADMIN   store descriptors (by image id or storage path)
--
--  The query image never reaches the database: only its descriptor does, and
--  nothing about the query is stored. Descriptors carry a version so that a
--  changed algorithm never compares against stale vectors.
--
--  Additive and idempotent: one extension, one table (RLS on, no public
--  policies — reads go through the functions), one index and five functions.
--  Never touches public.trademarks or public.trademark_images rows.
--
--  Supabase: run from the Dashboard SQL editor (the project owner role is
--  needed for `create extension`). Local stack: psql as postgres.
-- ============================================================================

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. Storage
-- ---------------------------------------------------------------------------
create table if not exists public.trademark_image_features (
  image_id            uuid primary key references public.trademark_images (id) on delete cascade,
  trademark_id        uuid not null references public.trademarks (id) on delete cascade,
  descriptor_version  int  not null,
  embedding           extensions.vector(369) not null,
  computed_at         timestamptz not null default now()
);

comment on table public.trademark_image_features is
  'Visual descriptors (pgvector) of trademark images for Search by Image. One row per image; versioned.';

create index if not exists trademark_image_features_trademark_idx
  on public.trademark_image_features (trademark_id);
create index if not exists trademark_image_features_version_idx
  on public.trademark_image_features (descriptor_version);
-- Approximate nearest-neighbour index (cosine). Exact scans are used below
-- hnsw.ef_search; the planner may use this index once the table grows.
create index if not exists trademark_image_features_embedding_hnsw
  on public.trademark_image_features using hnsw (embedding extensions.vector_cosine_ops);

alter table public.trademark_image_features enable row level security;
-- No policies on purpose: the table is only read/written through the
-- SECURITY DEFINER functions below (the search must only ever expose
-- published trademarks, and vectors themselves are not public data).
revoke all on table public.trademark_image_features from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Public: similarity search
--    p_embedding    the query descriptor (369 floats, L2-normalised)
--    p_version      descriptor version the client computed
--    p_limit        max trademarks returned (1..50)
--    p_min_similarity cosine-similarity floor (0..1)
--  Returns the same shape as search_trademarks() plus `similarity`, with the
--  image columns pointing at the image that matched. One row per trademark.
-- ---------------------------------------------------------------------------
create or replace function public.search_trademarks_by_image(
  p_embedding       double precision[],
  p_version         int,
  p_limit           int default 24,
  p_min_similarity  double precision default 0.55
)
returns table (
  id                          uuid,
  serial_number               text,
  record_number               text,
  mark_name                   text,
  applicant_name              text,
  applicant_address           text,
  trademark_class             text,
  class_numbers               int[],
  goods_and_services          text,
  application_type            text,
  attorney_or_representative  text,
  publication_date            date,
  objection_deadline          date,
  official_gazette_number     text,
  source_page                 text,
  review_status               text,
  primary_image_bucket        text,
  primary_image_path          text,
  primary_thumbnail_path      text,
  rank                        real,
  total_count                 bigint,
  similarity                  double precision,
  matched_image_id            uuid
)
language plpgsql stable security definer
set search_path = public, extensions
as $$
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
         t.attorney_or_representative, t.publication_date, t.objection_deadline,
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
end $$;

comment on function public.search_trademarks_by_image(double precision[], int, int, double precision) is
  'Search by Image: published trademarks whose indexed image is most similar (cosine) to the query descriptor.';

-- ---------------------------------------------------------------------------
-- 3. Public: index status (counts only — tells the UI whether image search is usable)
-- ---------------------------------------------------------------------------
create or replace function public.image_search_status(p_version int default null)
returns jsonb
language sql stable security definer
set search_path = public, extensions
as $$
  with v as (
    select coalesce(p_version, (select max(descriptor_version) from public.trademark_image_features)) as ver
  ),
  f as (
    select f.image_id, f.trademark_id
      from public.trademark_image_features f
      join public.trademarks t on t.id = f.trademark_id and t.is_published
     where f.descriptor_version = (select ver from v)
  )
  select jsonb_build_object(
    'available',           (select count(*) from f) > 0,
    'descriptor_version',  (select ver from v),
    'indexed_images',      (select count(*) from f),
    'indexed_trademarks',  (select count(distinct trademark_id) from f)
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. Admin: index status, missing images, upsert
-- ---------------------------------------------------------------------------
create or replace function public.admin_image_index_status(p_version int)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_matched  bigint;
  v_current  bigint;
  v_stale    bigint;
begin
  perform public.admin_assert();
  select count(*) into v_matched
    from public.trademark_images i
   where i.status = 'matched' and i.trademark_id is not null;
  select count(*) into v_current
    from public.trademark_image_features f
    join public.trademark_images i on i.id = f.image_id
   where i.status = 'matched' and f.descriptor_version = p_version;
  select count(*) into v_stale
    from public.trademark_image_features f
    join public.trademark_images i on i.id = f.image_id
   where i.status = 'matched' and f.descriptor_version <> p_version;
  return jsonb_build_object(
    'descriptor_version', p_version,
    'matched_images',     v_matched,
    'indexed',            v_current,
    'stale',              v_stale,
    'missing',            greatest(v_matched - v_current, 0),
    'last_computed_at',   (select max(computed_at) from public.trademark_image_features)
  );
end $$;

create or replace function public.admin_images_missing_features(
  p_version int,
  p_limit   int default 200,
  p_offset  int default 0
)
returns table (
  id              uuid,
  trademark_id    uuid,
  storage_bucket  text,
  storage_path    text,
  serial_number   text,
  content_type    text,
  byte_size       bigint
)
language plpgsql stable security definer
set search_path = public, extensions
as $$
begin
  perform public.admin_assert();
  return query
  select i.id, i.trademark_id, i.storage_bucket, i.storage_path, i.serial_number, i.content_type, i.byte_size
    from public.trademark_images i
   where i.status = 'matched' and i.trademark_id is not null
     and not exists (select 1 from public.trademark_image_features f
                      where f.image_id = i.id and f.descriptor_version = p_version)
   order by i.storage_path
   limit least(greatest(coalesce(p_limit, 200), 1), 1000)
  offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- p_items: [{ "image_id": uuid } | { "storage_path": text, "storage_bucket"?: text }, "embedding": [369 numbers]]
create or replace function public.admin_upsert_image_features(p_version int, p_items jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  x          jsonb;
  v_img      public.trademark_images%rowtype;
  v_vec      extensions.vector;
  v_arr      double precision[];
  n_up       int := 0;
  n_fail     int := 0;
  v_results  jsonb := '[]'::jsonb;
  v_key      text;
begin
  perform public.admin_assert();
  if p_version is null then
    raise exception 'Descriptor version is required' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'At most 500 items per call' using errcode = '22023';
  end if;

  for x in select * from jsonb_array_elements(p_items) loop
    begin
      v_key := coalesce(x ->> 'image_id', x ->> 'storage_path');
      if x ? 'image_id' then
        select * into v_img from public.trademark_images i where i.id = (x ->> 'image_id')::uuid;
      else
        select * into v_img from public.trademark_images i
         where i.storage_bucket = coalesce(nullif(x ->> 'storage_bucket', ''), 'trademark-images')
           and i.storage_path   = x ->> 'storage_path';
      end if;
      if v_img.id is null then
        raise exception 'Image not found' using errcode = 'P0002';
      end if;
      if v_img.trademark_id is null then
        raise exception 'Image is not linked to a trademark' using errcode = '23502';
      end if;
      if jsonb_typeof(x -> 'embedding') <> 'array' or jsonb_array_length(x -> 'embedding') <> 369 then
        raise exception 'Embedding must contain exactly 369 numbers' using errcode = '22023';
      end if;
      select array_agg(e::double precision order by ord) into v_arr
        from jsonb_array_elements_text(x -> 'embedding') with ordinality as t(e, ord);
      v_vec := v_arr::extensions.vector(369);

      insert into public.trademark_image_features as f (image_id, trademark_id, descriptor_version, embedding, computed_at)
      values (v_img.id, v_img.trademark_id, p_version, v_vec, now())
      on conflict (image_id) do update
         set trademark_id = excluded.trademark_id,
             descriptor_version = excluded.descriptor_version,
             embedding = excluded.embedding,
             computed_at = now();
      n_up := n_up + 1;
      v_results := v_results || jsonb_build_object('key', v_key, 'image_id', v_img.id, 'status', 'indexed');
    exception when others then
      n_fail := n_fail + 1;
      v_results := v_results || jsonb_build_object('key', v_key, 'status', 'failed', 'error', sqlerrm);
    end;
    v_img := null;
  end loop;

  return jsonb_build_object('upserted', n_up, 'failed', n_fail, 'results', v_results);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------
revoke all on function public.search_trademarks_by_image(double precision[], int, int, double precision) from public;
revoke all on function public.image_search_status(int)                        from public;
revoke all on function public.admin_image_index_status(int)                   from public, anon;
revoke all on function public.admin_images_missing_features(int, int, int)    from public, anon;
revoke all on function public.admin_upsert_image_features(int, jsonb)         from public, anon;

grant execute on function public.search_trademarks_by_image(double precision[], int, int, double precision) to anon, authenticated;
grant execute on function public.image_search_status(int)                        to anon, authenticated;
grant execute on function
  public.admin_image_index_status(int),
  public.admin_images_missing_features(int, int, int),
  public.admin_upsert_image_features(int, jsonb)
  to authenticated;

-- PostgREST: reload the schema cache so the new RPCs are visible immediately.
notify pgrst, 'reload schema';
