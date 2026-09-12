-- ============================================================================
-- TMistan — APPLY ALL MIGRATIONS (paste this whole file into the Supabase
-- SQL Editor and click RUN once).
--
-- Generated from supabase/migrations/0100 + 0200 + 0300 by
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

-- post-checks
commit;

select 'trademarks'        as object, count(*)::text as value from public.trademarks
union all select 'gazettes',           count(*)::text from public.gazettes
union all select 'search_trademarks', (select count(*)::text from pg_proc where proname = 'search_trademarks')
union all select 'rls trademarks',    (select relrowsecurity::text from pg_class where oid = 'public.trademarks'::regclass)
union all select 'policies',          (select count(*)::text from pg_policies where schemaname = 'public')
union all select 'anon can read',     (select count(*)::text from public.trademarks where is_published);
