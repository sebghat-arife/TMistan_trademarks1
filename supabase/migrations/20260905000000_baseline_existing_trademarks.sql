-- ============================================================================
-- 0000  BASELINE — mirror of the trademarks table that ALREADY EXISTS in
--       Supabase (populated by the Python Excel importer, ~732 rows).
--
--  ⚠  DO NOT run this file against the real Supabase project.
--     It exists only so the local development stack has the same starting
--     point as production. Every statement is IF NOT EXISTS so it is a no-op
--     if the table is already there, but the safe move is to skip it.
--
--     Real migrations start at 20260905000100_*.sql and are written to be
--     applied ON TOP of the existing table without touching existing rows.
--
--  ASSUMPTION (flagged for correction): the column list below is taken from
--  §3 of the strategy document. If the real table differs, edit this file
--  only — the later migrations use ADD COLUMN IF NOT EXISTS and never rename
--  or drop anything, so they remain valid.
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists public.trademarks (
  id                          uuid primary key default gen_random_uuid(),

  record_number               text,
  serial_number               text not null,

  mark_name                   text,
  mark_print                  text,

  applicant_name              text,
  applicant_address           text,

  trademark_class             text,
  goods_and_services          text,

  application_type            text,
  attorney_or_representative  text,

  publication_date            date,
  objection_deadline          date,

  official_gazette_number     text not null,

  new_address                 text,
  old_address                 text,
  new_owner                   text,
  old_owner                   text,

  source_page                 text,
  review_note                 text,

  source_file                 text,
  source_sheet                text,
  source_row                  integer,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- The existing uniqueness rule. Preserved verbatim; every later migration
-- relies on it and nothing may weaken it.
create unique index if not exists trademarks_gazette_serial_key
  on public.trademarks (official_gazette_number, serial_number);
