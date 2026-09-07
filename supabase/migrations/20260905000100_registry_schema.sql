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
-- such as "25", "25, 35", "Class 9 & 42".
create or replace function public.parse_class_numbers(p text)
returns int[]
language sql immutable parallel safe
as $$
  select coalesce(
    (select array_agg(distinct m[1]::int order by m[1]::int)
       from regexp_matches(coalesce(p, ''), '(\d{1,2})', 'g') m
      where m[1]::int between 1 and 45),
    '{}'::int[]
  );
$$;

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
