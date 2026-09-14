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

-- post-checks
commit;


select 'trademarks'        as object, count(*)::text as value from public.trademarks
union all select 'gazettes',           count(*)::text from public.gazettes
union all select 'search_trademarks', (select count(*)::text from pg_proc where proname = 'search_trademarks')
union all select 'rls trademarks',    (select relrowsecurity::text from pg_class where oid = 'public.trademarks'::regclass)
union all select 'policies',          (select count(*)::text from pg_policies where schemaname = 'public')
union all select 'anon can read',     (select count(*)::text from public.trademarks where is_published);
