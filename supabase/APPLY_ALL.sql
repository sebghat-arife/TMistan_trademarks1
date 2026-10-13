-- ============================================================================
-- TMistan — APPLY ALL MIGRATIONS (paste this whole file into the Supabase
-- SQL Editor and click RUN once).
--
-- Generated from supabase/migrations/0100 + 0200 + 0300 + 0400 + 0500 + 0600 + 0700 + 0800 + 0900 by
-- scripts/build_apply_all.py — do not edit by hand, edit the migrations.
--
-- Safe by construction:
--   • only ADDs tables / columns / functions / indexes / policies
--   • never drops, truncates, re-keys or rewrites public.trademarks rows
--   • idempotent — running it twice is harmless
-- Rehearsed on a copy of the production table (732 real rows) before release.
-- ============================================================================
begin;

-- ############################################################################
-- 20260905000100_registry_schema.sql
-- ############################################################################
-- ============================================================================
-- 0100  REGISTRY SCHEMA — additive migration on top of the existing
--       public.trademarks table.
--
--  Guarantees:
--    • No existing row is deleted, rewritten or re-keyed.
--    • No existing column is renamed, dropped or retyped.
--    • The unique rule (official_gazette_number, serial_number) is preserved.
--    • Everything is IF NOT EXISTS / CREATE OR REPLACE → safe to re-run.
--
--  What it adds:
--    1. Extensions        pg_trgm, unaccent, pgcrypto
--    2. Text normalisation functions (Latin + Arabic-script aware)
--    3. gazettes          one row per official gazette (auto-created)
--    4. trademarks        + review / publication / provenance columns
--                         + generated normalised search columns + indexes
--    5. trademark_images  metadata for files in Supabase Storage
--    6. import_jobs / import_job_items   ingestion history, never silent
--    7. audit_logs        + generic row-change trigger
--    8. user_roles        admin role lookup for RLS (used by 0300)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extensions (Supabase installs extensions in the `extensions` schema)
-- ---------------------------------------------------------------------------
create schema if not exists extensions;
create extension if not exists pgcrypto  with schema extensions;
create extension if not exists pg_trgm   with schema extensions;
create extension if not exists unaccent  with schema extensions;

-- ---------------------------------------------------------------------------
-- 2. Normalisation helpers
--    normalize_text() is IMMUTABLE so it can drive generated columns.
-- ---------------------------------------------------------------------------

-- unaccent() is only STABLE; wrap it so generated columns may use it.
-- The wrapper is built dynamically so it points at whichever schema the
-- extension actually lives in (extensions on Supabase, public on older DBs).
do $$
declare
  ext_schema text;
begin
  select n.nspname into ext_schema
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'unaccent';
  execute format($f$
    create or replace function public.immutable_unaccent(p text)
    returns text
    language sql immutable parallel safe strict
    as $body$ select %I.unaccent(%L::regdictionary, p) $body$;
  $f$, ext_schema, ext_schema || '.unaccent');
end $$;

comment on function public.immutable_unaccent(text) is
  'IMMUTABLE wrapper around unaccent() so it can be used in generated columns.';

-- Canonical searchable form of any text value:
--   • strips Arabic diacritics / tatweel
--   • unifies Arabic ي ك ة → Persian ی ک ه (Dari/Pashto spellings)
--   • maps Arabic-Indic & Extended Arabic-Indic digits → ASCII digits
--   • removes Latin accents, lower-cases
--   • collapses punctuation and whitespace to single spaces
create or replace function public.normalize_text(p text)
returns text
language sql immutable parallel safe
as $$
  select nullif(
    btrim(
      regexp_replace(
        lower(
          public.immutable_unaccent(
            translate(
              regexp_replace(coalesce(p, ''), '[\u064B-\u0652\u0670\u0640]', '', 'g'),
              'يكةۀ٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
              'یکهه01234567890123456789'
            )
          )
        ),
        '[[:punct:][:space:]\u060C\u061B\u061F\u00AB\u00BB\u2018\u2019\u201C\u201D\u2013\u2014]+', ' ', 'g'
      )
    ),
  '');
$$;

comment on function public.normalize_text(text) is
  'Canonical lower-cased, unaccented, punctuation-free form used for all matching.';

-- Nice classification numbers (1–45) parsed out of free-text class fields
-- such as "25", "25, 35", "Class 9 & 42", "4 (as printed)" and ranges "1-45"
-- (a range expands to every class it covers).
create or replace function public.parse_class_numbers(p text)
returns int[]
language sql immutable parallel safe
as $$
  with src as (
    -- Persian/Arabic-Indic digits → ASCII, then keep only digits, '-' and separators
    select translate(coalesce(p, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789') as v
  ),
  ranges as (
    select generate_series(m[1]::int, m[2]::int) as c
      from src, regexp_matches(src.v, '(\d{1,2})\s*[-–—]\s*(\d{1,2})', 'g') m
     where m[1]::int <= m[2]::int
  ),
  singles as (
    select m[1]::int as c
      from src, regexp_matches(regexp_replace(src.v, '\d{1,2}\s*[-–—]\s*\d{1,2}', ' ', 'g'), '(\d{1,2})', 'g') m
  )
  select coalesce(
    (select array_agg(distinct c order by c) from (select c from ranges union all select c from singles) x where c between 1 and 45),
    '{}'::int[]
  );
$$;

-- Dates in the registry are recorded exactly as printed in the Official
-- Gazette, i.e. in the Afghan Solar Hijri calendar (e.g. 1389-12-29). They are
-- stored unchanged in `date` columns. For comparisons with calendar input and
-- for sorting alongside any future Gregorian values, convert on the fly:
-- a year below 1500 is Solar Hijri, anything else is already Gregorian.
create or replace function public.solar_hijri_to_gregorian(jy int, jm int, jd int)
returns date
language plpgsql immutable parallel safe
as $$
declare
  y    int := jy + 1595;
  days int;
  gy   int;
  gm   int := 0;
  gd   int;
  sal  int[];
begin
  if jy is null or jm is null or jd is null or jm < 1 or jm > 12 or jd < 1 or jd > 31 then
    return null;
  end if;
  days := -355668 + 365 * y + (y / 33) * 8 + ((y % 33) + 3) / 4 + jd
          + case when jm < 7 then (jm - 1) * 31 else (jm - 7) * 30 + 186 end;
  gy   := 400 * (days / 146097);
  days := days % 146097;
  if days > 36524 then
    days := days - 1;
    gy   := gy + 100 * (days / 36524);
    days := days % 36524;
    if days >= 365 then days := days + 1; end if;
  end if;
  gy   := gy + 4 * (days / 1461);
  days := days % 1461;
  if days > 365 then
    gy   := gy + (days - 1) / 365;
    days := (days - 1) % 365;
  end if;
  gd  := days + 1;
  sal := array[0, 31, case when (gy % 4 = 0 and gy % 100 <> 0) or gy % 400 = 0 then 29 else 28 end,
               31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  while gm < 13 and gd > sal[gm + 1] loop
    gd := gd - sal[gm + 1];
    gm := gm + 1;
  end loop;
  return make_date(gy, gm, gd);
end $$;

create or replace function public.to_gregorian_date(d date)
returns date
language sql immutable parallel safe
as $$
  select case
    when d is null then null
    when extract(year from d) < 1500
      then public.solar_hijri_to_gregorian(extract(year from d)::int, extract(month from d)::int, extract(day from d)::int)
    else d
  end;
$$;

comment on function public.to_gregorian_date(date) is
  'Gregorian equivalent of a stored registry date (Solar Hijri when year < 1500, otherwise unchanged). Used for date filters and sorting.';

-- Prefix full-text query: "coca col" → 'coca':* & 'col':*
create or replace function public.to_prefix_tsquery(p text)
returns tsquery
language sql immutable parallel safe
as $$
  select case
    when public.normalize_text(p) is null then null
    else to_tsquery('simple',
           (select string_agg(tok || ':*', ' & ')
              from unnest(string_to_array(public.normalize_text(p), ' ')) tok
             where tok <> ''))
  end;
$$;

-- ---------------------------------------------------------------------------
-- Generic updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 3. gazettes
-- ---------------------------------------------------------------------------
create table if not exists public.gazettes (
  id                uuid primary key default gen_random_uuid(),
  gazette_number    text not null unique,
  publication_date  date,
  title             text,
  description       text,
  source_file       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.gazettes is
  'One row per official gazette issue. Rows are auto-created when a trademark referencing a new gazette number is inserted.';

drop trigger if exists gazettes_set_updated_at on public.gazettes;
create trigger gazettes_set_updated_at
  before update on public.gazettes
  for each row execute function public.set_updated_at();

-- Back-fill from the existing trademark rows (idempotent).
insert into public.gazettes (gazette_number, publication_date)
select t.official_gazette_number, min(t.publication_date)
  from public.trademarks t
 where t.official_gazette_number is not null
 group by t.official_gazette_number
on conflict (gazette_number) do nothing;

-- ---------------------------------------------------------------------------
-- 4. trademarks — additive columns
-- ---------------------------------------------------------------------------
alter table public.trademarks
  add column if not exists is_published    boolean     not null default true,
  add column if not exists review_status   text        not null default 'unreviewed',
  add column if not exists reviewed_by     uuid,
  add column if not exists reviewed_at     timestamptz,
  add column if not exists review_comment  text,
  add column if not exists import_job_id   uuid;

-- Normalised, generated search columns. They are STORED so they can be
-- indexed; they can never drift from the source columns.
alter table public.trademarks
  add column if not exists mark_name_normalized text
    generated always as (public.normalize_text(mark_name::text)) stored,
  add column if not exists applicant_name_normalized text
    generated always as (public.normalize_text(applicant_name::text)) stored,
  add column if not exists goods_and_services_normalized text
    generated always as (public.normalize_text(goods_and_services::text)) stored,
  add column if not exists attorney_normalized text
    generated always as (public.normalize_text(attorney_or_representative::text)) stored,
  add column if not exists serial_number_normalized text
    generated always as (public.normalize_text(serial_number::text)) stored,
  add column if not exists class_numbers int[]
    generated always as (public.parse_class_numbers(trademark_class::text)) stored,
  add column if not exists search_vector tsvector
    generated always as (
      setweight(to_tsvector('simple', coalesce(public.normalize_text(mark_name::text), '')), 'A') ||
      setweight(to_tsvector('simple', coalesce(public.normalize_text(serial_number::text), '')), 'A') ||
      setweight(to_tsvector('simple', coalesce(public.normalize_text(applicant_name::text), '')), 'B') ||
      setweight(to_tsvector('simple', coalesce(public.normalize_text(attorney_or_representative::text), '')), 'C') ||
      setweight(to_tsvector('simple', coalesce(public.normalize_text(goods_and_services::text), '')), 'D')
    ) stored;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'trademarks_review_status_check') then
    alter table public.trademarks
      add constraint trademarks_review_status_check
      check (review_status in ('unreviewed', 'reviewed', 'needs_correction', 'verified'));
  end if;
end $$;

-- Preserve/ensure the canonical uniqueness rule.
create unique index if not exists trademarks_gazette_serial_key
  on public.trademarks (official_gazette_number, serial_number);

-- Gazette relationship: FK on the natural key already present in the table,
-- so the existing Python Excel importer keeps working unchanged.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'trademarks_official_gazette_number_fkey') then
    alter table public.trademarks
      add constraint trademarks_official_gazette_number_fkey
      foreign key (official_gazette_number)
      references public.gazettes (gazette_number)
      on update cascade
      not valid;
    alter table public.trademarks validate constraint trademarks_official_gazette_number_fkey;
  end if;
end $$;

-- Auto-create the gazette row for any new gazette number.
create or replace function public.ensure_gazette_exists()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.official_gazette_number is not null then
    insert into public.gazettes (gazette_number, publication_date)
    values (new.official_gazette_number, new.publication_date)
    on conflict (gazette_number) do update
      set publication_date = coalesce(public.gazettes.publication_date, excluded.publication_date);
  end if;
  return new;
end $$;

drop trigger if exists trademarks_ensure_gazette on public.trademarks;
create trigger trademarks_ensure_gazette
  before insert or update of official_gazette_number on public.trademarks
  for each row execute function public.ensure_gazette_exists();

drop trigger if exists trademarks_set_updated_at on public.trademarks;
create trigger trademarks_set_updated_at
  before update on public.trademarks
  for each row execute function public.set_updated_at();

-- Indexes -------------------------------------------------------------------
create index if not exists trademarks_serial_number_idx
  on public.trademarks (serial_number);
create index if not exists trademarks_gazette_idx
  on public.trademarks (official_gazette_number);
create index if not exists trademarks_publication_date_idx
  on public.trademarks (publication_date desc nulls last);
create index if not exists trademarks_publication_gregorian_idx
  on public.trademarks (public.to_gregorian_date(publication_date) desc nulls last);
create index if not exists trademarks_application_type_idx
  on public.trademarks (application_type);
create index if not exists trademarks_review_status_idx
  on public.trademarks (review_status) where review_status <> 'verified';
create index if not exists trademarks_class_numbers_gin
  on public.trademarks using gin (class_numbers);
create index if not exists trademarks_search_vector_gin
  on public.trademarks using gin (search_vector);
create index if not exists trademarks_mark_name_trgm
  on public.trademarks using gin (mark_name_normalized extensions.gin_trgm_ops);
create index if not exists trademarks_applicant_trgm
  on public.trademarks using gin (applicant_name_normalized extensions.gin_trgm_ops);
create index if not exists trademarks_goods_trgm
  on public.trademarks using gin (goods_and_services_normalized extensions.gin_trgm_ops);
create index if not exists trademarks_attorney_trgm
  on public.trademarks using gin (attorney_normalized extensions.gin_trgm_ops);
create index if not exists trademarks_serial_trgm
  on public.trademarks using gin (serial_number_normalized extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 5. trademark_images — metadata only; bytes live in Supabase Storage
-- ---------------------------------------------------------------------------
create table if not exists public.trademark_images (
  id                 uuid primary key default gen_random_uuid(),
  trademark_id       uuid references public.trademarks (id) on delete cascade,

  image_type         text not null default 'logo',      -- logo | mark_print | source_crop | other
  status             text not null default 'matched',   -- matched | unmatched | ambiguous | needs_review
  match_method       text,                              -- e.g. gazette_serial_filename | manual

  storage_bucket     text not null default 'trademark-images',
  storage_path       text not null,                     -- 1011/1011-002.png
  thumbnail_path     text,                              -- thumbs/1011/1011-002.webp

  original_filename  text,
  source_folder      text,
  gazette_number     text,
  serial_number      text,

  width              int,
  height             int,
  byte_size          bigint,
  content_type       text,
  content_hash       text,                              -- sha256 of the original bytes

  sort_order         int not null default 0,
  import_job_id      uuid,
  review_note        text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint trademark_images_status_check
    check (status in ('matched', 'unmatched', 'ambiguous', 'needs_review')),
  constraint trademark_images_type_check
    check (image_type in ('logo', 'mark_print', 'source_crop', 'other')),
  constraint trademark_images_matched_requires_trademark
    check (status <> 'matched' or trademark_id is not null),
  constraint trademark_images_bucket_path_key unique (storage_bucket, storage_path)
);

comment on table public.trademark_images is
  'Metadata for images stored in Supabase Storage. Never store image bytes here. Unmatched images keep trademark_id NULL and wait in the admin review queue.';

-- Idempotency: identical bytes may not be attached twice to the same trademark/type.
create unique index if not exists trademark_images_unique_content
  on public.trademark_images (trademark_id, image_type, content_hash)
  where trademark_id is not null and content_hash is not null;

create index if not exists trademark_images_trademark_idx
  on public.trademark_images (trademark_id, status, sort_order);
create index if not exists trademark_images_status_idx
  on public.trademark_images (status) where status <> 'matched';
create index if not exists trademark_images_gazette_serial_idx
  on public.trademark_images (gazette_number, serial_number);

drop trigger if exists trademark_images_set_updated_at on public.trademark_images;
create trigger trademark_images_set_updated_at
  before update on public.trademark_images
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. import_jobs / import_job_items — nothing is allowed to fail silently
-- ---------------------------------------------------------------------------
create table if not exists public.import_jobs (
  id               uuid primary key default gen_random_uuid(),
  job_type         text not null,                        -- excel | images
  filename         text,
  source_path      text,
  gazette_number   text,
  dry_run          boolean not null default false,

  status           text not null default 'queued',       -- queued | processing | completed | completed_with_warnings | failed
  started_at       timestamptz,
  completed_at     timestamptz,

  total_rows       int not null default 0,
  inserted_rows    int not null default 0,
  updated_rows     int not null default 0,
  skipped_rows     int not null default 0,
  failed_rows      int not null default 0,

  error_message    text,
  summary          jsonb not null default '{}'::jsonb,
  created_by       uuid,
  created_at       timestamptz not null default now(),

  constraint import_jobs_status_check
    check (status in ('queued', 'processing', 'completed', 'completed_with_warnings', 'failed')),
  constraint import_jobs_type_check
    check (job_type in ('excel', 'images'))
);

create table if not exists public.import_job_items (
  id          bigint generated always as identity primary key,
  job_id      uuid not null references public.import_jobs (id) on delete cascade,
  item_ref    text,                 -- filename or "Sheet!row"
  status      text not null,        -- inserted | updated | skipped | failed | unmatched | ambiguous
  message     text,
  payload     jsonb,
  created_at  timestamptz not null default now(),
  constraint import_job_items_status_check
    check (status in ('inserted', 'updated', 'skipped', 'failed', 'unmatched', 'ambiguous'))
);

create index if not exists import_jobs_created_idx on public.import_jobs (created_at desc);
create index if not exists import_job_items_job_idx on public.import_job_items (job_id, status);

-- ---------------------------------------------------------------------------
-- 7. audit_logs + generic trigger
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id              bigint generated always as identity primary key,
  table_name      text not null,
  row_id          text not null,
  action          text not null,           -- INSERT | UPDATE | DELETE
  changed_fields  jsonb,                   -- {"col": {"old": .., "new": ..}}
  old_data        jsonb,
  new_data        jsonb,
  actor_id        uuid,
  actor_role      text,
  created_at      timestamptz not null default now()
);

create index if not exists audit_logs_row_idx on public.audit_logs (table_name, row_id, created_at desc);
create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);

create or replace function public.audit_row_change()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old   jsonb;
  v_new   jsonb;
  v_diff  jsonb := '{}'::jsonb;
  v_key   text;
  v_actor uuid;
  v_role  text;
  v_row   text;
  v_generated text[];
begin
  -- Generated columns (normalised search fields) are derived data: exclude
  -- them from the diff so the log only shows what a human actually changed.
  select coalesce(array_agg(column_name::text), '{}')
    into v_generated
    from information_schema.columns
   where table_schema = tg_table_schema
     and table_name   = tg_table_name
     and is_generated = 'ALWAYS';
  begin
    v_actor := nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  exception when others then v_actor := null; end;
  if v_actor is null then
    begin
      v_actor := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
    exception when others then v_actor := null; end;
  end if;
  v_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user::text);

  if tg_op = 'INSERT' then
    v_new := to_jsonb(new) - v_generated;
    v_row := coalesce(v_new ->> 'id', '');
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old) - v_generated;
    v_new := to_jsonb(new) - v_generated;
    v_row := coalesce(v_new ->> 'id', '');
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key in ('updated_at') then continue; end if;
      if (v_old -> v_key) is distinct from (v_new -> v_key) then
        v_diff := v_diff || jsonb_build_object(v_key, jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key));
      end if;
    end loop;
    if v_diff = '{}'::jsonb then
      return new; -- nothing meaningful changed
    end if;
  else
    v_old := to_jsonb(old) - v_generated;
    v_row := coalesce(v_old ->> 'id', '');
  end if;

  insert into public.audit_logs (table_name, row_id, action, changed_fields, old_data, new_data, actor_id, actor_role)
  values (tg_table_name, v_row, tg_op, nullif(v_diff, '{}'::jsonb), v_old, v_new, v_actor, v_role);

  return coalesce(new, old);
end $$;

drop trigger if exists trademarks_audit on public.trademarks;
create trigger trademarks_audit
  after insert or update or delete on public.trademarks
  for each row execute function public.audit_row_change();

drop trigger if exists trademark_images_audit on public.trademark_images;
create trigger trademark_images_audit
  after insert or update or delete on public.trademark_images
  for each row execute function public.audit_row_change();

drop trigger if exists gazettes_audit on public.gazettes;
create trigger gazettes_audit
  after insert or update or delete on public.gazettes
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------------
-- 8. user_roles — who is an admin (used by RLS in 0300)
-- ---------------------------------------------------------------------------
create table if not exists public.user_roles (
  user_id     uuid primary key,          -- = auth.users.id
  role        text not null default 'admin',
  granted_by  uuid,
  created_at  timestamptz not null default now(),
  constraint user_roles_role_check check (role in ('admin', 'editor', 'viewer'))
);

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles r
     where r.user_id = auth.uid()
       and r.role in ('admin', 'editor')
  );
$$;

comment on function public.is_admin() is
  'True when the current JWT subject has an admin/editor row in user_roles.';

-- ############################################################################
-- 20260905000200_search.sql
-- ############################################################################
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
     order by sim desc, public.to_gregorian_date(t.publication_date) desc nulls last
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
            public.to_gregorian_date(t.publication_date) desc nulls last, t.created_at desc, t.serial_number
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

-- ############################################################################
-- 20260905000300_rls_and_storage.sql
-- ############################################################################
-- ============================================================================
-- 0300  ROW LEVEL SECURITY + STORAGE BUCKETS
--
--  Public (anon / authenticated without a role):
--      SELECT published trademarks, gazettes, matched images
--  Admin / editor (row in user_roles):
--      SELECT everything, INSERT/UPDATE trademarks, images, gazettes, jobs
--  Nobody through the API:
--      DELETE trademarks (bulk tooling uses the service role, never the browser)
--
--  The Python importers run with the service-role key on a trusted machine
--  — the service role bypasses RLS by design. That key is never shipped to
--  the frontend.
-- ============================================================================

alter table public.trademarks        enable row level security;
alter table public.gazettes          enable row level security;
alter table public.trademark_images  enable row level security;
alter table public.import_jobs       enable row level security;
alter table public.import_job_items  enable row level security;
alter table public.audit_logs        enable row level security;
alter table public.user_roles        enable row level security;

-- trademarks ----------------------------------------------------------------
drop policy if exists "public read published trademarks" on public.trademarks;
create policy "public read published trademarks"
  on public.trademarks for select
  to anon, authenticated
  using (is_published or public.is_admin());

drop policy if exists "admin insert trademarks" on public.trademarks;
create policy "admin insert trademarks"
  on public.trademarks for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "admin update trademarks" on public.trademarks;
create policy "admin update trademarks"
  on public.trademarks for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
-- (no delete policy on purpose)

-- gazettes ------------------------------------------------------------------
drop policy if exists "public read gazettes" on public.gazettes;
create policy "public read gazettes"
  on public.gazettes for select
  to anon, authenticated
  using (true);

drop policy if exists "admin write gazettes" on public.gazettes;
create policy "admin write gazettes"
  on public.gazettes for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- trademark_images ----------------------------------------------------------
drop policy if exists "public read matched images" on public.trademark_images;
create policy "public read matched images"
  on public.trademark_images for select
  to anon, authenticated
  using (
    public.is_admin()
    or (status = 'matched'
        and exists (select 1 from public.trademarks t
                     where t.id = trademark_images.trademark_id and t.is_published))
  );

drop policy if exists "admin write images" on public.trademark_images;
create policy "admin write images"
  on public.trademark_images for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- import jobs / items -------------------------------------------------------
drop policy if exists "admin read import jobs" on public.import_jobs;
create policy "admin read import jobs"
  on public.import_jobs for select to authenticated using (public.is_admin());

drop policy if exists "admin read import items" on public.import_job_items;
create policy "admin read import items"
  on public.import_job_items for select to authenticated using (public.is_admin());

-- audit logs: admins read; nobody writes via API (trigger is SECURITY DEFINER)
drop policy if exists "admin read audit logs" on public.audit_logs;
create policy "admin read audit logs"
  on public.audit_logs for select to authenticated using (public.is_admin());

-- user_roles: a user can see their own row; admins see all
drop policy if exists "read own role" on public.user_roles;
create policy "read own role"
  on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Grants (Supabase default roles) -------------------------------------------
-- Hosted Supabase grants anon/authenticated ALL privileges on new public
-- tables through default privileges; RLS is what protects the data. Revoke the
-- privileges the browser roles must never have so protection does not rely on
-- RLS alone (harmless where the grant never existed, e.g. the local stack).
revoke all on public.import_jobs, public.import_job_items, public.audit_logs, public.user_roles
  from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.trademarks, public.gazettes, public.trademark_images
  from anon;
revoke delete, truncate, references, trigger
  on public.trademarks, public.gazettes, public.trademark_images
  from authenticated;
revoke all on all sequences in schema public from anon;

grant usage on schema public to anon, authenticated;
grant select on public.trademarks, public.gazettes, public.trademark_images,
                public.gazette_summaries, public.trademark_primary_images
  to anon, authenticated;
grant select on public.import_jobs, public.import_job_items, public.audit_logs, public.user_roles
  to authenticated;
grant insert, update on public.trademarks, public.gazettes, public.trademark_images to authenticated;
grant execute on function
  public.search_trademarks(text, text, text, text, text, int[], text, text, text, date, date, boolean, text, int, int),
  public.similar_trademarks(uuid, int),
  public.trademark_filter_options(),
  public.registry_stats(),
  public.recent_trademarks(int),
  public.trademarks_by_class(),
  public.normalize_text(text),
  public.gazette_sort_key(text),
  public.to_gregorian_date(date),
  public.solar_hijri_to_gregorian(int, int, int)
  to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage
--
-- Buckets are created with the Storage API / Dashboard, NOT here: since
-- April 2025 the SQL editor role on hosted Supabase is not the owner of
-- storage.objects, so `create policy ... on storage.objects` fails with
-- "must be owner of table objects", and inserting into storage.buckets from
-- SQL bypasses the Storage service's own bookkeeping.
--
-- Required configuration (done by scripts/setup_storage.py, idempotent):
--   • bucket  trademark-images   PUBLIC   (10 MB, image/* only)
--       - anyone may GET /storage/v1/object/public/trademark-images/<path>
--       - uploads/deletes only with the service-role key (importers) —
--         no storage.objects policy grants anon/authenticated any write
--   • bucket  source-documents   PRIVATE  (50 MB)
--       - readable/writable only with the service-role key
--
-- Because no policy on storage.objects is created for anon/authenticated, the
-- browser can only read public-bucket objects — exactly what the app needs.
-- ---------------------------------------------------------------------------

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

-- ############################################################################
-- 20261011000500_image_search.sql
-- ############################################################################
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

-- ############################################################################
-- 20261012000600_data_management.sql
-- ############################################################################
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

-- ############################################################################
-- 20261013000800_contact_requests.sql
-- ############################################################################
-- ============================================================================
-- 0800 — Contact & Feedback inquiries
-- ----------------------------------------------------------------------------
-- What it does
--   • ADDs one private table, public.contact_requests, that stores the
--     inquiries sent from the public Contact & Feedback page (/contact).
--   • ADDs submit_contact_request(): the ONLY way the public site can write
--     an inquiry. It validates every field on the server (lengths, e-mail
--     syntax, inquiry type, whitelisted extra fields), discards honeypot
--     submissions, and rate-limits by e-mail address, by caller IP (stored
--     only as a salted SHA-256 hash) and globally.
--   • ADDs contact_form_status(): cheap probe the page uses to know whether
--     this migration is applied (otherwise it shows "form not available").
--   • ADDs admin_list_contact_requests / admin_get_contact_request /
--     admin_update_contact_request / admin_contact_counts for the Admin
--     Center "Inquiries" page. All start with admin_assert() (0400) and
--     status changes are written to admin_actions (0600).
--
-- Privacy / security model
--   • Row Level Security is enabled and NO policy exists for anon or
--     authenticated, and all table privileges are revoked from them: nobody
--     can read, list, change or delete inquiries through the public API —
--     not even the person who submitted one. Only the SECURITY DEFINER
--     functions above (and the service role) touch the table.
--   • No e-mail credentials or secrets are involved. Forwarding inquiries by
--     e-mail is a separate, optional step (see docs/CONTACT.md).
--
-- What it does NOT do
--   • Touches no existing table, column, policy, function or row.
--
-- Prerequisites: 0400 (admin_assert) and 0600 (admin_record_action).
-- Idempotent — safe to re-run.
-- ============================================================================

-- No extension needed: gen_random_uuid() and sha256() are built into PostgreSQL 13+ / 11+.

create table if not exists public.contact_requests (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  inquiry_type   text not null check (inquiry_type in ('general', 'trademark-research', 'data-correction', 'technical-support')),
  full_name      text not null check (length(full_name) between 2 and 120),
  email          text not null check (length(email) between 5 and 254),
  organization   text check (organization is null or length(organization) <= 200),
  subject        text not null check (length(subject) between 3 and 200),
  message        text not null check (length(message) between 10 and 5000),
  details        jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  locale         text check (locale is null or length(locale) <= 12),
  page_url       text check (page_url is null or length(page_url) <= 500),
  user_agent     text check (user_agent is null or length(user_agent) <= 300),
  ip_hash        text check (ip_hash is null or length(ip_hash) = 64),
  status         text not null default 'new' check (status in ('new', 'in_progress', 'closed', 'spam')),
  admin_note     text check (admin_note is null or length(admin_note) <= 4000),
  handled_by     uuid,
  handled_at     timestamptz
);
comment on table public.contact_requests is
  'Inquiries from the public Contact & Feedback page. Private: written only through submit_contact_request(), read only by administrators (admin_* functions).';

create index if not exists contact_requests_created_idx on public.contact_requests (created_at desc);
create index if not exists contact_requests_status_idx  on public.contact_requests (status, created_at desc);
create index if not exists contact_requests_email_idx   on public.contact_requests (lower(email), created_at desc);
create index if not exists contact_requests_ip_idx      on public.contact_requests (ip_hash, created_at desc) where ip_hash is not null;

alter table public.contact_requests enable row level security;
-- No policies on purpose: with RLS on and no policy, anon/authenticated can do nothing even if a
-- grant slipped through. Belt and braces: revoke every table privilege as well.
revoke all on table public.contact_requests from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Public probe: "is the contact form backed by this database?"
-- ----------------------------------------------------------------------------
create or replace function public.contact_form_status()
returns jsonb
language sql stable
set search_path = public as $$
  select jsonb_build_object('available', true, 'max_message_length', 5000, 'version', 1);
$$;
revoke all on function public.contact_form_status() from public;
grant execute on function public.contact_form_status() to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Public write path
-- ----------------------------------------------------------------------------
create or replace function public.submit_contact_request(
  p_inquiry_type text,
  p_full_name    text,
  p_email        text,
  p_subject      text,
  p_message      text,
  p_organization text  default null,
  p_details      jsonb default '{}'::jsonb,
  p_locale       text  default null,
  p_page_url     text  default null,
  p_honeypot     text  default null
)
returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  v_headers  jsonb;
  v_ip       text;
  v_ip_hash  text;
  v_ua       text;
  v_details  jsonb;
  v_name     text := btrim(coalesce(p_full_name, ''));
  v_email    text := btrim(coalesce(p_email, ''));
  v_subject  text := btrim(coalesce(p_subject, ''));
  v_message  text := btrim(coalesce(p_message, ''));
  v_org      text := nullif(btrim(coalesce(p_organization, '')), '');
  v_count    int;
  v_id       uuid;
  v_now      timestamptz := now();
begin
  -- Honeypot: real visitors never see this field; bots fill it. Pretend success, store nothing.
  if nullif(btrim(coalesce(p_honeypot, '')), '') is not null then
    return jsonb_build_object('id', gen_random_uuid(), 'received_at', v_now);
  end if;

  -- Server-side validation (the browser validates too, but is not trusted)
  if p_inquiry_type is null or p_inquiry_type not in ('general', 'trademark-research', 'data-correction', 'technical-support') then
    raise exception 'Please choose a valid inquiry type.' using errcode = '22023';
  end if;
  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'Please enter your full name (2–120 characters).' using errcode = '22023';
  end if;
  if length(v_email) < 5 or length(v_email) > 254 or v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' then
    raise exception 'Please enter a valid e-mail address.' using errcode = '22023';
  end if;
  if length(v_subject) < 3 or length(v_subject) > 200 then
    raise exception 'Please enter a subject (3–200 characters).' using errcode = '22023';
  end if;
  if length(v_message) < 10 or length(v_message) > 5000 then
    raise exception 'Please describe your request (10–5000 characters).' using errcode = '22023';
  end if;
  if v_org is not null and length(v_org) > 200 then
    raise exception 'Organization is too long (max 200 characters).' using errcode = '22023';
  end if;
  if p_details is not null and jsonb_typeof(p_details) <> 'object' then
    raise exception 'Invalid request details.' using errcode = '22023';
  end if;

  -- Keep only the known category-specific fields, each clipped to 1000 characters.
  select coalesce(jsonb_object_agg(d.key, left(d.value, 1000)), '{}'::jsonb)
    into v_details
    from jsonb_each_text(coalesce(p_details, '{}'::jsonb)) d
   where d.key in ('trademark_name', 'serial_number', 'applicant_name', 'trademark_class', 'gazette_number',
                   'source_page', 'research_type', 'response_format', 'purpose', 'deadline',
                   'issue_category', 'issue_url', 'browser_info')
     and nullif(btrim(d.value), '') is not null;
  if pg_column_size(v_details) > 12000 then
    raise exception 'Request details are too large.' using errcode = '22023';
  end if;

  -- Request metadata exposed by PostgREST (absent when called from psql)
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;
  v_ip := nullif(btrim(coalesce(
            v_headers ->> 'cf-connecting-ip',
            split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1),
            v_headers ->> 'x-real-ip', '')), '');
  v_ua := left(v_headers ->> 'user-agent', 300);
  -- The address itself is never stored: only a salted hash used for rate limiting.
  if v_ip is not null then
    v_ip_hash := encode(sha256(convert_to('tmistan-contact:' || v_ip, 'UTF8')), 'hex');
  end if;

  -- Rate limits (server-side, cannot be bypassed by the browser)
  select count(*) into v_count from public.contact_requests
   where lower(email) = lower(v_email) and created_at > v_now - interval '1 hour';
  if v_count >= 5 then
    raise exception 'Too many requests from this e-mail address in the last hour. Please try again later.' using errcode = 'TM429';
  end if;
  if v_ip_hash is not null then
    select count(*) into v_count from public.contact_requests
     where ip_hash = v_ip_hash and created_at > v_now - interval '1 hour';
    if v_count >= 10 then
      raise exception 'Too many requests from this connection in the last hour. Please try again later.' using errcode = 'TM429';
    end if;
  end if;
  select count(*) into v_count from public.contact_requests where created_at > v_now - interval '10 minutes';
  if v_count >= 60 then
    raise exception 'The contact form is receiving unusually many requests. Please try again in a few minutes.' using errcode = 'TM429';
  end if;

  insert into public.contact_requests
      (inquiry_type, full_name, email, organization, subject, message, details, locale, page_url, user_agent, ip_hash)
  values
      (p_inquiry_type, v_name, v_email, v_org, v_subject, v_message, v_details,
       left(nullif(btrim(coalesce(p_locale, '')), ''), 12), left(nullif(btrim(coalesce(p_page_url, '')), ''), 500), v_ua, v_ip_hash)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'received_at', v_now);
end $$;
revoke all on function public.submit_contact_request(text, text, text, text, text, text, jsonb, text, text, text) from public;
grant execute on function public.submit_contact_request(text, text, text, text, text, text, jsonb, text, text, text) to anon, authenticated;
comment on function public.submit_contact_request(text, text, text, text, text, text, jsonb, text, text, text) is
  'Public Contact & Feedback form. Validates, rate-limits (e-mail / hashed IP / global) and stores the inquiry; never returns other people''s data.';

-- ----------------------------------------------------------------------------
-- Administrator read / triage path (Admin Center → Inquiries)
-- ----------------------------------------------------------------------------
create or replace function public.admin_contact_counts()
returns jsonb
language plpgsql stable security definer
set search_path = public as $$
begin
  perform public.admin_assert();
  return (
    select jsonb_build_object(
      'total',       count(*),
      'new',         count(*) filter (where status = 'new'),
      'in_progress', count(*) filter (where status = 'in_progress'),
      'closed',      count(*) filter (where status = 'closed'),
      'spam',        count(*) filter (where status = 'spam'),
      'last_24h',    count(*) filter (where created_at > now() - interval '24 hours'))
    from public.contact_requests);
end $$;
revoke all on function public.admin_contact_counts() from public, anon;
grant execute on function public.admin_contact_counts() to authenticated;

create or replace function public.admin_list_contact_requests(
  p_status text default null,
  p_type   text default null,
  p_query  text default null,
  p_limit  int  default 50,
  p_offset int  default 0
)
returns table (
  id uuid, created_at timestamptz, inquiry_type text, full_name text, email text, organization text,
  subject text, message text, details jsonb, locale text, page_url text, status text, admin_note text,
  handled_by uuid, handled_at timestamptz, total_count bigint
)
language plpgsql stable security definer
set search_path = public as $$
declare
  v_limit  int  := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int  := greatest(coalesce(p_offset, 0), 0);
  v_q      text := nullif(btrim(coalesce(p_query, '')), '');
begin
  perform public.admin_assert();
  return query
  select c.id, c.created_at, c.inquiry_type, c.full_name, c.email, c.organization,
         c.subject, c.message, c.details, c.locale, c.page_url, c.status, c.admin_note,
         c.handled_by, c.handled_at, count(*) over () as total_count
    from public.contact_requests c
   where (p_status is null or p_status = '' or c.status = p_status)
     and (p_type   is null or p_type   = '' or c.inquiry_type = p_type)
     and (v_q is null
          or c.full_name ilike '%' || v_q || '%'
          or c.email     ilike '%' || v_q || '%'
          or c.subject   ilike '%' || v_q || '%'
          or c.message   ilike '%' || v_q || '%'
          or c.id::text  ilike v_q || '%'
          or coalesce(c.details ->> 'serial_number', '') ilike '%' || v_q || '%')
   order by c.created_at desc
   limit v_limit offset v_offset;
end $$;
revoke all on function public.admin_list_contact_requests(text, text, text, int, int) from public, anon;
grant execute on function public.admin_list_contact_requests(text, text, text, int, int) to authenticated;

create or replace function public.admin_get_contact_request(p_id uuid)
returns public.contact_requests
language plpgsql stable security definer
set search_path = public as $$
declare v_row public.contact_requests;
begin
  perform public.admin_assert();
  select * into v_row from public.contact_requests where id = p_id;
  return v_row;
end $$;
revoke all on function public.admin_get_contact_request(uuid) from public, anon;
grant execute on function public.admin_get_contact_request(uuid) to authenticated;

create or replace function public.admin_update_contact_request(p_id uuid, p_status text, p_admin_note text default null)
returns public.contact_requests
language plpgsql security definer
set search_path = public as $$
declare v_row public.contact_requests;
begin
  perform public.admin_assert();
  if p_status is null or p_status not in ('new', 'in_progress', 'closed', 'spam') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  update public.contact_requests
     set status     = p_status,
         admin_note = left(nullif(btrim(coalesce(p_admin_note, '')), ''), 4000),
         handled_by = auth.uid(),
         handled_at = now()
   where id = p_id
   returning * into v_row;
  if v_row.id is null then
    raise exception 'Inquiry not found' using errcode = 'P0002';
  end if;
  perform public.admin_record_action('contact.update', 'contact_request', array[p_id::text], '{}', '{}', null, 1, 'success',
                                     jsonb_build_object('status', p_status, 'has_note', p_admin_note is not null));
  return v_row;
end $$;
revoke all on function public.admin_update_contact_request(uuid, text, text) from public, anon;
grant execute on function public.admin_update_contact_request(uuid, text, text) to authenticated;

-- PostgREST: pick up the new table/functions immediately
notify pgrst, 'reload schema';

-- ############################################################################
-- 20261013000900_correction_requests.sql
-- ############################################################################
-- ============================================================================
-- 0900 — Data Correction & Verification Requests
-- ----------------------------------------------------------------------------
-- What it does
--   • Adds TWO new private tables: public.correction_requests (RLS on, no policies, no grants —
--     nobody can read or write it through the API) and public.correction_request_events
--     (status history, same protection).
--   • Adds the public functions
--       correction_form_status()                      capability probe
--       submit_correction_request(...)                validated, rate-limited write path; returns
--                                                     {id, reference, received_at, upload_until}
--       correction_request_status(reference, email)   requester-side status check (needs BOTH values)
--       correction_upload_allowed(name)               used by the Storage policy below
--   • Adds the admin functions (admin_assert(), logged through admin_record_action):
--       admin_correction_counts(), admin_list_correction_requests(...),
--       admin_get_correction_request(id) (row + events + evidence files),
--       admin_update_correction_request(id, status, internal_note, public_note, trademark_serial)
--   • Storage (hosted Supabase only — skipped on the local stack): private bucket
--     `correction-evidence` (5 MB, JPG/PNG/PDF) and policies that let a visitor upload at most
--     3 files to <request-id>/… within 15 minutes of submitting, and let administrators read/delete.
--
-- What it does NOT do
--   • Touches no existing table, column, policy, function or row. Nothing is ever written to
--     public.trademarks by a visitor: a request is a request for review, administrators decide.
--
-- Prerequisites: 0400 (admin_assert, is_admin) and 0600 (admin_record_action). 0700/0800 not required.
-- Idempotent — safe to re-run.
-- ============================================================================

create table if not exists public.correction_requests (
  id              uuid primary key default gen_random_uuid(),
  reference       text not null unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  request_type    text not null check (request_type in
                    ('incorrect_name', 'classification', 'image', 'publication_reference', 'duplicate', 'other')),
  full_name       text not null check (length(full_name) between 2 and 120),
  email           text not null check (length(email) between 5 and 254),
  related_record  text check (related_record is null or length(related_record) <= 120),
  trademark_id    uuid references public.trademarks(id) on delete set null,
  description     text not null check (length(description) between 10 and 5000),
  locale          text check (locale is null or length(locale) <= 10),
  page_url        text check (page_url is null or length(page_url) <= 500),
  user_agent      text check (user_agent is null or length(user_agent) <= 300),
  ip_hash         text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  status          text not null default 'received' check (status in
                    ('received', 'under_review', 'more_info_needed', 'resolved', 'closed_no_change')),
  internal_note   text check (internal_note is null or length(internal_note) <= 4000),
  public_note     text check (public_note is null or length(public_note) <= 2000),
  handled_by      uuid,
  handled_at      timestamptz
);
comment on table public.correction_requests is
  'Public data-correction / verification requests. Private: readable only through admin_* functions. A request never changes a trademark row by itself.';

create index if not exists correction_requests_created_idx on public.correction_requests (created_at desc);
create index if not exists correction_requests_status_idx  on public.correction_requests (status, created_at desc);
create index if not exists correction_requests_email_idx   on public.correction_requests (lower(email), created_at desc);
create index if not exists correction_requests_ip_idx      on public.correction_requests (ip_hash, created_at desc) where ip_hash is not null;
create index if not exists correction_requests_tm_idx      on public.correction_requests (trademark_id) where trademark_id is not null;

create table if not exists public.correction_request_events (
  id          bigserial primary key,
  request_id  uuid not null references public.correction_requests(id) on delete cascade,
  created_at  timestamptz not null default now(),
  actor_id    uuid,
  from_status text,
  to_status   text not null,
  note        text check (note is null or length(note) <= 2000)
);
create index if not exists correction_request_events_req_idx on public.correction_request_events (request_id, created_at);

alter table public.correction_requests        enable row level security;
alter table public.correction_request_events  enable row level security;
revoke all on table public.correction_requests       from public, anon, authenticated;
revoke all on table public.correction_request_events from public, anon, authenticated;
revoke all on sequence public.correction_request_events_id_seq from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Public probe
-- ----------------------------------------------------------------------------
create or replace function public.correction_form_status()
returns jsonb
language sql stable
set search_path = public as $$
  select jsonb_build_object(
    'available', true,
    'max_description_length', 5000,
    'upload', jsonb_build_object('max_files', 3, 'max_bytes', 5242880, 'types', array['image/jpeg', 'image/png', 'application/pdf'],
                                 'window_minutes', 15, 'bucket', 'correction-evidence'),
    'version', 1);
$$;
revoke all on function public.correction_form_status() from public;
grant execute on function public.correction_form_status() to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Reference generator: CR-XXXXXXXX (Crockford-style alphabet, no 0/O/1/I confusion)
-- ----------------------------------------------------------------------------
create or replace function public.correction_reference()
returns text
language plpgsql volatile
set search_path = public as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_ref text;
  i int;
begin
  -- Not a secret on its own: the status check also requires the requester's e-mail address.
  loop
    v_ref := 'CR-';
    for i in 1..8 loop
      v_ref := v_ref || substr(v_alphabet, 1 + floor(random() * 32)::int, 1);
    end loop;
    exit when not exists (select 1 from public.correction_requests where reference = v_ref);
  end loop;
  return v_ref;
end $$;
revoke all on function public.correction_reference() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Public write path
-- ----------------------------------------------------------------------------
create or replace function public.submit_correction_request(
  p_request_type   text,
  p_full_name      text,
  p_email          text,
  p_description    text,
  p_related_record text default null,
  p_locale         text default null,
  p_page_url       text default null,
  p_honeypot       text default null
)
returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  v_headers jsonb;
  v_ip      text;
  v_ip_hash text;
  v_ua      text;
  v_name    text := btrim(coalesce(p_full_name, ''));
  v_email   text := btrim(coalesce(p_email, ''));
  v_desc    text := btrim(coalesce(p_description, ''));
  v_record  text := nullif(btrim(coalesce(p_related_record, '')), '');
  v_tm      uuid;
  v_count   int;
  v_id      uuid;
  v_ref     text;
  v_now     timestamptz := now();
begin
  -- Honeypot: real visitors never see this field; bots fill it. Pretend success, store nothing.
  if nullif(btrim(coalesce(p_honeypot, '')), '') is not null then
    return jsonb_build_object('id', gen_random_uuid(), 'reference', 'CR-' || upper(substr(md5(random()::text), 1, 8)),
                              'received_at', v_now, 'upload_until', v_now);
  end if;

  if p_request_type is null or p_request_type not in ('incorrect_name', 'classification', 'image', 'publication_reference', 'duplicate', 'other') then
    raise exception 'Please choose a valid request type.' using errcode = '22023';
  end if;
  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'Please enter your full name (2–120 characters).' using errcode = '22023';
  end if;
  if length(v_email) < 5 or length(v_email) > 254 or v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' then
    raise exception 'Please enter a valid e-mail address.' using errcode = '22023';
  end if;
  if length(v_desc) < 10 or length(v_desc) > 5000 then
    raise exception 'Please describe the issue (10–5000 characters).' using errcode = '22023';
  end if;
  if v_record is not null and length(v_record) > 120 then
    raise exception 'The record reference is too long (max 120 characters).' using errcode = '22023';
  end if;

  -- Request metadata exposed by PostgREST (absent when called from psql)
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then v_headers := null; end;
  v_ip := nullif(btrim(coalesce(
            v_headers ->> 'cf-connecting-ip',
            split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1),
            v_headers ->> 'x-real-ip', '')), '');
  v_ua := left(v_headers ->> 'user-agent', 300);
  if v_ip is not null then
    v_ip_hash := encode(sha256(convert_to('tmistan-contact:' || v_ip, 'UTF8')), 'hex');
  end if;

  -- Rate limits (server-side)
  select count(*) into v_count from public.correction_requests
   where lower(email) = lower(v_email) and created_at > v_now - interval '1 hour';
  if v_count >= 5 then
    raise exception 'Too many requests from this e-mail address in the last hour. Please try again later.' using errcode = 'TM429';
  end if;
  if v_ip_hash is not null then
    select count(*) into v_count from public.correction_requests
     where ip_hash = v_ip_hash and created_at > v_now - interval '1 hour';
    if v_count >= 10 then
      raise exception 'Too many requests from this connection in the last hour. Please try again later.' using errcode = 'TM429';
    end if;
  end if;
  select count(*) into v_count from public.correction_requests where created_at > v_now - interval '10 minutes';
  if v_count >= 60 then
    raise exception 'The service is receiving too many requests right now. Please try again in a few minutes.' using errcode = 'TM429';
  end if;

  -- Convenience link: when the reference IS a serial number we know, remember the record.
  if v_record is not null then
    select t.id into v_tm from public.trademarks t
     where t.serial_number = v_record
        or t.serial_number = regexp_replace(v_record, '^(serial|sn)[:#[:space:]]*', '', 'i')
     limit 1;
  end if;

  v_ref := public.correction_reference();
  insert into public.correction_requests
    (reference, request_type, full_name, email, related_record, trademark_id, description,
     locale, page_url, user_agent, ip_hash)
  values
    (v_ref, p_request_type, v_name, v_email, v_record, v_tm, v_desc,
     left(nullif(btrim(coalesce(p_locale, '')), ''), 10), left(nullif(btrim(coalesce(p_page_url, '')), ''), 500), v_ua, v_ip_hash)
  returning id into v_id;
  insert into public.correction_request_events (request_id, actor_id, from_status, to_status, note)
  values (v_id, null, null, 'received', null);

  return jsonb_build_object('id', v_id, 'reference', v_ref, 'received_at', v_now, 'upload_until', v_now + interval '15 minutes');
end $$;
revoke all on function public.submit_correction_request(text, text, text, text, text, text, text, text) from public;
grant execute on function public.submit_correction_request(text, text, text, text, text, text, text, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Requester-side status check: needs the reference AND the e-mail used.
-- Returns null when the pair does not match (no hint which part was wrong).
-- ----------------------------------------------------------------------------
create or replace function public.correction_request_status(p_reference text, p_email text)
returns jsonb
language plpgsql stable security definer
set search_path = public as $$
declare
  r record;
begin
  if p_reference is null or p_email is null then return null; end if;
  select c.reference, c.status, c.request_type, c.created_at, c.updated_at, c.public_note
    into r
    from public.correction_requests c
   where c.reference = upper(btrim(p_reference))
     and lower(c.email) = lower(btrim(p_email));
  if not found then return null; end if;
  return jsonb_build_object('reference', r.reference, 'status', r.status, 'request_type', r.request_type,
                            'created_at', r.created_at, 'updated_at', r.updated_at, 'public_note', r.public_note);
end $$;
revoke all on function public.correction_request_status(text, text) from public;
grant execute on function public.correction_request_status(text, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Storage gate used by the upload policy: <request-id>/<name>.<jpg|jpeg|png|pdf>,
-- request created < 15 minutes ago, at most 3 files per request, at most 40 uploads
-- per hour across the whole bucket (bounds the worst case for an abuser).
-- ----------------------------------------------------------------------------
create or replace function public.correction_upload_allowed(p_name text)
returns boolean
language plpgsql stable security definer
set search_path = public as $$
declare
  v_id    uuid;
  v_count int;
begin
  if p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-z]{8,40}\.(jpg|jpeg|png|pdf)$' then
    return false;
  end if;
  v_id := split_part(p_name, '/', 1)::uuid;
  if not exists (select 1 from public.correction_requests c
                  where c.id = v_id and c.created_at > now() - interval '15 minutes') then
    return false;
  end if;
  if to_regclass('storage.objects') is not null then
    execute 'select count(*) from storage.objects where bucket_id = $1 and name like $2'
       into v_count using 'correction-evidence', v_id::text || '/%';
    if v_count >= 3 then return false; end if;
    execute 'select count(*) from storage.objects where bucket_id = $1 and created_at > now() - interval ''1 hour'''
       into v_count using 'correction-evidence';
    if v_count >= 40 then return false; end if;
  end if;
  return true;
end $$;
revoke all on function public.correction_upload_allowed(text) from public;
grant execute on function public.correction_upload_allowed(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Admin side
-- ----------------------------------------------------------------------------
create or replace function public.admin_correction_counts()
returns jsonb
language plpgsql stable security definer
set search_path = public as $$
begin
  perform public.admin_assert();
  return (select jsonb_build_object(
    'total',            count(*),
    'received',         count(*) filter (where status = 'received'),
    'under_review',     count(*) filter (where status = 'under_review'),
    'more_info_needed', count(*) filter (where status = 'more_info_needed'),
    'resolved',         count(*) filter (where status = 'resolved'),
    'closed_no_change', count(*) filter (where status = 'closed_no_change'),
    'last_24h',         count(*) filter (where created_at > now() - interval '24 hours'))
   from public.correction_requests);
end $$;
revoke all on function public.admin_correction_counts() from public, anon;
grant execute on function public.admin_correction_counts() to authenticated;

create or replace function public.admin_list_correction_requests(
  p_status text default null, p_type text default null, p_query text default null,
  p_limit int default 50, p_offset int default 0)
returns table (
  id uuid, reference text, created_at timestamptz, updated_at timestamptz, request_type text,
  full_name text, email text, related_record text, trademark_id uuid, trademark_serial text,
  description text, locale text, page_url text, status text, internal_note text, public_note text,
  handled_by uuid, handled_at timestamptz, total_count bigint)
language plpgsql stable security definer
set search_path = public as $$
declare
  v_limit  int  := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int  := greatest(coalesce(p_offset, 0), 0);
  v_q      text := nullif(btrim(coalesce(p_query, '')), '');
begin
  perform public.admin_assert();
  return query
  select c.id, c.reference, c.created_at, c.updated_at, c.request_type,
         c.full_name, c.email, c.related_record, c.trademark_id, t.serial_number as trademark_serial,
         c.description, c.locale, c.page_url, c.status, c.internal_note, c.public_note,
         c.handled_by, c.handled_at, count(*) over () as total_count
    from public.correction_requests c
    left join public.trademarks t on t.id = c.trademark_id
   where (p_status is null or p_status = '' or c.status = p_status)
     and (p_type   is null or p_type   = '' or c.request_type = p_type)
     and (v_q is null
          or c.reference      ilike '%' || v_q || '%'
          or c.full_name      ilike '%' || v_q || '%'
          or c.email          ilike '%' || v_q || '%'
          or c.description    ilike '%' || v_q || '%'
          or coalesce(c.related_record, '') ilike '%' || v_q || '%'
          or coalesce(t.serial_number, '')  ilike '%' || v_q || '%'
          or c.id::text ilike v_q || '%')
   order by c.created_at desc
   limit v_limit offset v_offset;
end $$;
revoke all on function public.admin_list_correction_requests(text, text, text, int, int) from public, anon;
grant execute on function public.admin_list_correction_requests(text, text, text, int, int) to authenticated;

create or replace function public.admin_get_correction_request(p_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public as $$
declare
  v_row    jsonb;
  v_events jsonb;
  v_files  jsonb := '[]'::jsonb;
begin
  perform public.admin_assert();
  select to_jsonb(c) || jsonb_build_object('trademark_serial', t.serial_number, 'trademark_name', t.mark_name)
    into v_row
    from public.correction_requests c
    left join public.trademarks t on t.id = c.trademark_id
   where c.id = p_id;
  if v_row is null then
    raise exception 'Correction request not found' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'created_at', e.created_at, 'actor_id', e.actor_id,
                                               'from_status', e.from_status, 'to_status', e.to_status, 'note', e.note)
                            order by e.created_at), '[]'::jsonb)
    into v_events
    from public.correction_request_events e where e.request_id = p_id;
  if to_regclass('storage.objects') is not null then
    begin
      execute $q$
        select coalesce(jsonb_agg(jsonb_build_object('name', o.name, 'created_at', o.created_at,
                 'size', (o.metadata ->> 'size')::bigint, 'mimetype', o.metadata ->> 'mimetype') order by o.created_at), '[]'::jsonb)
          from storage.objects o where o.bucket_id = $1 and o.name like $2 $q$
         into v_files using 'correction-evidence', p_id::text || '/%';
    exception when others then v_files := '[]'::jsonb; end;
  end if;
  return v_row - 'ip_hash' || jsonb_build_object('events', v_events, 'files', v_files);
end $$;
revoke all on function public.admin_get_correction_request(uuid) from public, anon;
grant execute on function public.admin_get_correction_request(uuid) to authenticated;

create or replace function public.admin_update_correction_request(
  p_id uuid, p_status text, p_internal_note text default null, p_public_note text default null,
  p_trademark_serial text default null)
returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  v_old   public.correction_requests%rowtype;
  v_tm    uuid;
  v_actor uuid := auth.uid();
begin
  perform public.admin_assert();
  if p_status is null or p_status not in ('received', 'under_review', 'more_info_needed', 'resolved', 'closed_no_change') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  select * into v_old from public.correction_requests where id = p_id for update;
  if not found then
    raise exception 'Correction request not found' using errcode = 'P0002';
  end if;
  if v_old.status <> 'received' and p_status = 'received' then
    raise exception 'A request cannot go back to "received".' using errcode = '22023';
  end if;
  if p_trademark_serial is not null and btrim(p_trademark_serial) <> '' then
    select t.id into v_tm from public.trademarks t where t.serial_number = btrim(p_trademark_serial) limit 1;
    if v_tm is null then
      raise exception 'No trademark record has serial number %', btrim(p_trademark_serial) using errcode = '22023';
    end if;
  else
    v_tm := v_old.trademark_id;
  end if;

  -- Notes: null = keep the stored value, '' = clear it.
  update public.correction_requests
     set status        = p_status,
         internal_note = case when p_internal_note is null then v_old.internal_note
                              else left(nullif(btrim(p_internal_note), ''), 4000) end,
         public_note   = case when p_public_note is null then v_old.public_note
                              else left(nullif(btrim(p_public_note), ''), 2000) end,
         trademark_id  = v_tm,
         handled_by    = v_actor,
         handled_at    = now(),
         updated_at    = now()
   where id = p_id;
  if v_old.status is distinct from p_status then
    insert into public.correction_request_events (request_id, actor_id, from_status, to_status, note)
    values (p_id, v_actor, v_old.status, p_status,
            case when p_public_note is null then v_old.public_note else left(nullif(btrim(p_public_note), ''), 2000) end);
  end if;
  perform public.admin_record_action('correction.update', 'correction_request', array[p_id::text],
    case when v_tm is not null then array[(select serial_number from public.trademarks where id = v_tm)] else '{}'::text[] end,
    '{}', null, 1, 'success',
    jsonb_build_object('reference', v_old.reference, 'from', v_old.status, 'to', p_status));
  return public.admin_get_correction_request(p_id);
end $$;
revoke all on function public.admin_update_correction_request(uuid, text, text, text, text) from public, anon;
grant execute on function public.admin_update_correction_request(uuid, text, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Storage: private evidence bucket + policies (hosted Supabase only).
-- Bucket row: created here when the editor role may write storage.buckets; otherwise
-- scripts/setup_storage.py creates it through the Storage API (same settings).
-- ----------------------------------------------------------------------------
do $$
declare
  p record;
begin
  if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then
    raise notice 'storage schema not present (local stack) — evidence bucket and policies skipped';
    return;
  end if;
  begin
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('correction-evidence', 'correction-evidence', false, 5242880, array['image/jpeg', 'image/png', 'application/pdf'])
    on conflict (id) do update
      set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'application/pdf'];
  exception when others then
    raise notice 'Could not create bucket correction-evidence here (%). Run: python3 scripts/setup_storage.py', sqlerrm;
  end;
  for p in
    select * from (values
      ('tmistan visitor upload correction evidence', 'insert', 'anon, authenticated',
       'with check (bucket_id = ''correction-evidence'' and public.correction_upload_allowed(name))'),
      ('tmistan admin select correction evidence', 'select', 'authenticated',
       'using (bucket_id = ''correction-evidence'' and public.is_admin())'),
      ('tmistan admin delete correction evidence', 'delete', 'authenticated',
       'using (bucket_id = ''correction-evidence'' and public.is_admin())')
    ) as v(name, cmd, roles, clause)
  loop
    begin
      if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = p.name) then
        execute format('drop policy %I on storage.objects', p.name);
      end if;
      execute format('create policy %I on storage.objects for %s to %s %s', p.name, p.cmd, p.roles, p.clause);
    exception when insufficient_privilege then
      raise notice 'Could not create Storage policy "%" here (%). Create it in Dashboard → Storage → Policies: FOR % TO % %',
        p.name, sqlerrm, upper(p.cmd), p.roles, p.clause;
    end;
  end loop;
end $$;

-- PostgREST: pick up the new table/functions immediately
notify pgrst, 'reload schema';

-- post-checks
commit;











select 'trademarks'        as object, count(*)::text as value from public.trademarks
union all select 'gazettes',           count(*)::text from public.gazettes
union all select 'search_trademarks', (select count(*)::text from pg_proc where proname = 'search_trademarks')
union all select 'rls trademarks',    (select relrowsecurity::text from pg_class where oid = 'public.trademarks'::regclass)
union all select 'policies',          (select count(*)::text from pg_policies where schemaname = 'public')
union all select 'anon can read',     (select count(*)::text from public.trademarks where is_published);
