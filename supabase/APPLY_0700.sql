-- ============================================================================
-- TMistan — APPLY MIGRATION 0700 (search by application / registration number)
--
-- Paste this whole file into the Supabase SQL Editor and click RUN once.
-- Generated from supabase/migrations/20261013000700_search_numbers.sql by
-- scripts/build_apply_all.py — do not edit by hand, edit the migration.
--
-- Prerequisite: migration 0600 (APPLY_0600.sql) is in place — it adds the
-- trademarks.application_number / registration_number columns.
--
-- Safe by construction — FUNCTION ONLY:
--   • re-creates public.search_trademarks() with two extra optional
--     parameters (p_application_number, p_registration_number) and lets the
--     keyword search match those two columns
--   • touches no table, column, index, policy, storage object or data row
--   • idempotent — running it twice is harmless
--
-- Afterwards: Search → Advanced search → "Application number" and
-- "Registration number" become editable, and typing a number into the main
-- search box finds the record. Nothing else changes.
-- ============================================================================
begin;

-- ############################################################################
-- 20261013000700_search_numbers.sql
-- ############################################################################
-- ============================================================================
-- 0700 — Search by application number / registration number
-- ----------------------------------------------------------------------------
-- What it does
--   • search_trademarks() gains two optional parameters, p_application_number
--     and p_registration_number (substring match on the normalised value, so
--     "77821" finds "R-77821" and Persian/Arabic-Indic digits work), and the keyword search
--     (p_query) now also matches those two columns, so a visitor can type an
--     application or registration number straight into the main search box.
--   • Everything else (ranking, sorting, paging, the result row type, the
--     attorney-free public columns) is unchanged from 0600.
--
-- What it does NOT do
--   • No table, column, index, policy, grant on tables, storage object or
--     trademark row is created, altered or deleted. Function-only.
--
-- Why DROP + CREATE instead of CREATE OR REPLACE
--   Adding parameters would create a second overload next to the 0600 one;
--   PostgREST then cannot choose between them ("Could not choose the best
--   candidate function") and *every* search breaks. Dropping the old signature
--   first keeps exactly one search_trademarks().
--
-- Prerequisite: 0600 (adds the two columns). Idempotent — safe to re-run.
-- Until this migration is applied, the web app detects the missing parameters
-- (PGRST202) and simply searches without the two number filters.
-- ============================================================================

drop function if exists public.search_trademarks(text, text, text, text, text, integer[], text, text, text, date, date, boolean, text, integer, integer);

create or replace function public.search_trademarks(
  p_query               text      default null,
  p_mark                text      default null,
  p_applicant           text      default null,
  p_serial              text      default null,
  p_gazette             text      default null,
  p_classes             integer[] default null,
  p_goods               text      default null,
  p_application_type    text      default null,
  p_attorney            text      default null,   -- kept for signature compatibility; ignored (never a public filter)
  p_date_from           date      default null,
  p_date_to             date      default null,
  p_fuzzy               boolean   default true,
  p_sort                text      default 'relevance',
  p_limit               integer   default 20,
  p_offset              integer   default 0,
  p_application_number  text      default null,   -- NEW (0700)
  p_registration_number text      default null    -- NEW (0700)
)
returns setof public.trademark_search_result
language plpgsql stable
set search_path = public, extensions
as $function$
declare
  nq        text    := public.normalize_text(p_query);
  tsq       tsquery := public.to_prefix_tsquery(p_query);
  n_mark    text    := public.normalize_text(p_mark);
  n_app     text    := public.normalize_text(p_applicant);
  n_serial  text    := public.normalize_text(p_serial);
  n_goods   text    := public.normalize_text(p_goods);
  n_appno   text    := public.normalize_text(p_application_number);
  n_regno   text    := public.normalize_text(p_registration_number);
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
             case when public.normalize_text(t.application_number) = nq
                    or public.normalize_text(t.registration_number) = nq then 9 else 0 end,
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
             or public.normalize_text(t.application_number)  like '%' || nq || '%'
             or public.normalize_text(t.registration_number) like '%' || nq || '%'
             or (p_fuzzy and t.mark_name_normalized % nq)
           ))
       and (n_mark   is null or t.mark_name_normalized ilike '%' || n_mark || '%'
                             or (p_fuzzy and t.mark_name_normalized % n_mark))
       and (n_app    is null or t.applicant_name_normalized ilike '%' || n_app || '%')
       and (n_serial is null or t.serial_number_normalized ilike n_serial || '%')
       and (n_gaz    is null or t.official_gazette_number = n_gaz)
       and (v_classes is null or t.class_numbers && v_classes)
       and (n_goods  is null or t.goods_and_services_normalized ilike '%' || n_goods || '%')
       and (n_appno  is null or public.normalize_text(t.application_number)  like '%' || n_appno || '%')
       and (n_regno  is null or public.normalize_text(t.registration_number) like '%' || n_regno || '%')
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

-- Same callers as before (0300 granted execute on the 0600 signature; the new
-- signature needs its own grant).
revoke all on function public.search_trademarks(text, text, text, text, text, integer[], text, text, text, date, date, boolean, text, integer, integer, text, text) from public;
grant execute on function public.search_trademarks(text, text, text, text, text, integer[], text, text, text, date, date, boolean, text, integer, integer, text, text) to anon, authenticated, service_role;

comment on function public.search_trademarks(text, text, text, text, text, integer[], text, text, text, date, date, boolean, text, integer, integer, text, text) is
  'Public trademark search (0700): keyword + combinable filters incl. application/registration number; attorney is never searched or returned.';

-- PostgREST: pick up the new signature immediately
notify pgrst, 'reload schema';

commit;

-- post-checks -------------------------------------------------------------
select 'search_trademarks overloads (must be 1)' as object,
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'search_trademarks') as value
union all select 'has p_application_number',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'search_trademarks'
           and 'p_application_number' = any(p.proargnames))
union all select 'anon may execute',
       (select count(*)::text from information_schema.routine_privileges
         where specific_schema = 'public' and routine_name = 'search_trademarks' and grantee = 'anon' and privilege_type = 'EXECUTE')
union all select 'trademarks (unchanged)', count(*)::text from public.trademarks
union all select 'published trademarks', (select count(*)::text from public.trademarks where is_published);
