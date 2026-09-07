-- ============================================================================
-- 0200  SEARCH — all searching happens inside PostgreSQL.
--
--  The frontend NEVER downloads the table and filters in JavaScript.
--  It calls these RPCs / views through PostgREST (supabase-js .rpc()).
--
--    search_trademarks(...)        main search + combinable filters + paging
--    similar_trademarks(id)        text similarity (pg_trgm) for detail pages
--    trademark_filter_options()    facet values for the filter panel
--    registry_stats()              headline numbers (home page / dashboard)
--    gazette_summaries (view)      gazette list with counts
--    trademark_primary_images      one "best" image per trademark
-- ============================================================================

-- Sort key so "1011" < "1018" < "1022" < "101" does NOT happen (text sort).
create or replace function public.gazette_sort_key(p text)
returns bigint language sql immutable parallel safe as $$
  select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '')::bigint;
$$;

-- ---------------------------------------------------------------------------
-- Primary image per trademark (logo > mark_print > source_crop > other)
-- ---------------------------------------------------------------------------
create or replace view public.trademark_primary_images
with (security_invoker = true) as
select distinct on (i.trademark_id)
       i.trademark_id, i.id as image_id, i.storage_bucket, i.storage_path,
       i.thumbnail_path, i.image_type, i.width, i.height
  from public.trademark_images i
 where i.status = 'matched' and i.trademark_id is not null
 order by i.trademark_id,
          case i.image_type when 'logo' then 0 when 'mark_print' then 1 when 'source_crop' then 2 else 3 end,
          i.sort_order, i.created_at;

-- ---------------------------------------------------------------------------
-- Gazette summaries
-- ---------------------------------------------------------------------------
create or replace view public.gazette_summaries
with (security_invoker = true) as
select g.id,
       g.gazette_number,
       g.publication_date,
       g.title,
       g.description,
       g.source_file,
       g.created_at,
       coalesce(c.trademark_count, 0)::int as trademark_count,
       coalesce(i.image_count, 0)::int     as image_count,
       c.first_publication_date,
       c.last_publication_date,
       public.gazette_sort_key(g.gazette_number) as sort_key
  from public.gazettes g
  left join (
        select t.official_gazette_number,
               count(*) as trademark_count,
               min(t.publication_date) as first_publication_date,
               max(t.publication_date) as last_publication_date
          from public.trademarks t
         where t.is_published
         group by t.official_gazette_number
       ) c on c.official_gazette_number = g.gazette_number
  left join (
        select t.official_gazette_number, count(*) as image_count
          from public.trademark_images im
          join public.trademarks t on t.id = im.trademark_id
         where im.status = 'matched'
         group by t.official_gazette_number
       ) i on i.official_gazette_number = g.gazette_number;

-- ---------------------------------------------------------------------------
-- Result row type shared by search_trademarks() and similar_trademarks()
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'trademark_search_result' and typnamespace = 'public'::regnamespace) then
    create type public.trademark_search_result as (
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
      total_count                 bigint
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- search_trademarks
-- ---------------------------------------------------------------------------
create or replace function public.search_trademarks(
  p_query             text     default null,   -- global search box
  p_mark              text     default null,
  p_applicant         text     default null,
  p_serial            text     default null,
  p_gazette           text     default null,
  p_classes           int[]    default null,
  p_goods             text     default null,
  p_application_type  text     default null,
  p_attorney          text     default null,
  p_date_from         date     default null,
  p_date_to           date     default null,
  p_fuzzy             boolean  default true,
  p_sort              text     default 'relevance', -- relevance|newest|oldest|mark_asc|mark_desc|serial
  p_limit             int      default 20,
  p_offset            int      default 0
)
returns setof public.trademark_search_result
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
  nq        text    := public.normalize_text(p_query);
  tsq       tsquery := public.to_prefix_tsquery(p_query);
  n_mark    text    := public.normalize_text(p_mark);
  n_app     text    := public.normalize_text(p_applicant);
  n_serial  text    := public.normalize_text(p_serial);
  n_goods   text    := public.normalize_text(p_goods);
  n_att     text    := public.normalize_text(p_attorney);
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
           t.attorney_or_representative, t.publication_date, t.objection_deadline,
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
       and (n_att    is null or t.attorney_normalized ilike '%' || n_att || '%')
       and (p_date_from is null or t.publication_date >= p_date_from)
       and (p_date_to   is null or t.publication_date <= p_date_to)
  ),
  page as (
    select b.*,
           count(*) over () as total_count,
           row_number() over (
             order by
               case when v_sort = 'relevance' then b.rank end desc nulls last,
               case when v_sort = 'newest'    then b.publication_date end desc nulls last,
               case when v_sort = 'oldest'    then b.publication_date end asc  nulls last,
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
         p.attorney_or_representative, p.publication_date, p.objection_deadline,
         p.official_gazette_number, p.source_page, p.review_status,
         img.storage_bucket, img.storage_path, img.thumbnail_path,
         p.rank, p.total_count
    from page p
    left join public.trademark_primary_images img on img.trademark_id = p.id
   order by p.rn;
end $$;

comment on function public.search_trademarks is
  'Server-side trademark search. All filters combine with AND; p_query is a global box matched against mark, applicant, serial, gazette and goods (prefix FTS + trigram fuzzy).';

-- ---------------------------------------------------------------------------
-- similar_trademarks — text similarity by mark name (pg_trgm). This is the
-- "text similarity" half of §10; visual similarity (embeddings) is a later
-- phase and will get its own column/index, not a change to this function.
-- ---------------------------------------------------------------------------
create or replace function public.similar_trademarks(p_id uuid, p_limit int default 8)
returns setof public.trademark_search_result
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with src as (
    select id, mark_name_normalized from public.trademarks where id = p_id
  ),
  hits as (
    select t.*, similarity(t.mark_name_normalized, s.mark_name_normalized) as sim
      from public.trademarks t
      cross join src s
     where t.id <> s.id
       and t.is_published
       and s.mark_name_normalized is not null
       and (t.mark_name_normalized % s.mark_name_normalized
            or t.mark_name_normalized like s.mark_name_normalized || '%'
            or s.mark_name_normalized like t.mark_name_normalized || '%')
     order by sim desc, t.publication_date desc nulls last
     limit least(greatest(coalesce(p_limit, 8), 1), 50)
  )
  select h.id, h.serial_number, h.record_number, h.mark_name, h.applicant_name, h.applicant_address,
         h.trademark_class, h.class_numbers, h.goods_and_services, h.application_type,
         h.attorney_or_representative, h.publication_date, h.objection_deadline,
         h.official_gazette_number, h.source_page, h.review_status,
         img.storage_bucket, img.storage_path, img.thumbnail_path,
         h.sim::real as rank, count(*) over () as total_count
    from hits h
    left join public.trademark_primary_images img on img.trademark_id = h.id
   order by h.sim desc;
$$;

-- ---------------------------------------------------------------------------
-- Facets for the filter panel
-- ---------------------------------------------------------------------------
create or replace function public.trademark_filter_options()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'gazettes', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'gazette_number', gs.gazette_number,
               'publication_date', gs.publication_date,
               'count', gs.trademark_count)
             order by gs.sort_key desc nulls last, gs.gazette_number desc), '[]'::jsonb)
        from public.gazette_summaries gs
       where gs.trademark_count > 0
    ),
    'classes', (
      select coalesce(jsonb_agg(jsonb_build_object('class', x.cls, 'count', x.n) order by x.cls), '[]'::jsonb)
        from (select unnest(t.class_numbers) as cls, count(*) as n
                from public.trademarks t where t.is_published group by 1) x
    ),
    'application_types', (
      select coalesce(jsonb_agg(jsonb_build_object('value', x.v, 'count', x.n) order by x.n desc), '[]'::jsonb)
        from (select t.application_type as v, count(*) as n
                from public.trademarks t
               where t.is_published and nullif(btrim(t.application_type), '') is not null
               group by 1) x
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- Headline stats
-- ---------------------------------------------------------------------------
create or replace function public.registry_stats()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'trademarks',        (select count(*) from public.trademarks where is_published),
    'applicants',        (select count(distinct applicant_name_normalized) from public.trademarks
                           where is_published and applicant_name_normalized is not null),
    'gazettes',          (select count(*) from public.gazette_summaries where trademark_count > 0),
    'images',            (select count(*) from public.trademark_images where status = 'matched'),
    'unmatched_images',  (select count(*) from public.trademark_images where status <> 'matched'),
    'needs_review',      (select count(*) from public.trademarks where review_status in ('unreviewed', 'needs_correction')),
    'latest_gazette',    (select gazette_number from public.gazette_summaries where trademark_count > 0
                           order by sort_key desc nulls last, gazette_number desc limit 1),
    'latest_publication_date', (select max(publication_date) from public.trademarks where is_published)
  );
$$;

-- ---------------------------------------------------------------------------
-- Recently added trademarks (home page). Newest publication first, then the
-- most recently imported; same row shape as search results.
-- ---------------------------------------------------------------------------
create or replace function public.recent_trademarks(p_limit int default 8)
returns setof public.trademark_search_result
language sql
stable
security invoker
set search_path = public
as $$
  select t.id, t.serial_number, t.record_number, t.mark_name, t.applicant_name, t.applicant_address,
         t.trademark_class, t.class_numbers, t.goods_and_services, t.application_type,
         t.attorney_or_representative, t.publication_date, t.objection_deadline,
         t.official_gazette_number, t.source_page, t.review_status,
         img.storage_bucket, img.storage_path, img.thumbnail_path,
         0::real as rank, count(*) over () as total_count
    from public.trademarks t
    left join public.trademark_primary_images img on img.trademark_id = t.id
   where t.is_published
   order by public.gazette_sort_key(t.official_gazette_number) desc nulls last,
            t.publication_date desc nulls last, t.created_at desc, t.serial_number
   limit least(greatest(coalesce(p_limit, 8), 1), 48);
$$;

-- Trademarks per Nice class (admin dashboard chart)
create or replace function public.trademarks_by_class()
returns table (class int, count bigint)
language sql stable security invoker set search_path = public as $$
  select c as class, count(*) as count
    from public.trademarks t, unnest(t.class_numbers) c
   where t.is_published
   group by c order by c;
$$;
