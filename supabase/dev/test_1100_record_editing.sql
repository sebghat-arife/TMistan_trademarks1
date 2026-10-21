-- =============================================================================
-- LOCAL DEV ONLY — scenario tests for migration 1100 (direct record editing).
-- Runs against the local stack (scripts/local-stack/start.sh), never against
-- production:
--   psql -h /tmp -p 54329 -U postgres -d afg_registry -v ON_ERROR_STOP=1 \
--        -f supabase/dev/test_1100_record_editing.sql
-- Deliberately NOT one big transaction — now() is frozen inside a transaction
-- and the tests check that updated_at advances. Rows use the reserved local
-- serial range 9001-*/9002-* and are deleted at the end.
-- =============================================================================
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
\o /dev/null

-- harness helpers ---------------------------------------------------------------
create or replace function pg_temp.as_user(p_sub text, p_role text, p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_sub, 'role', p_role, 'email', p_email)::text, false);
  perform set_config('request.jwt.claim.sub', p_sub, false);
  perform set_config('request.jwt.claim.role', p_role, false);
end $$;

-- owner-privileged reads (the harness, not the app): full row as jsonb
create or replace function pg_temp.tm(p_id uuid) returns jsonb language sql security definer as $$
  select to_jsonb(t) from public.trademarks t where t.id = p_id
$$;
create or replace function pg_temp.col(p_id uuid, p_col text) returns text language sql security definer as $$
  select to_jsonb(t) ->> p_col from public.trademarks t where t.id = p_id
$$;

create or replace function pg_temp.expect_error(p_sql text, p_code text, p_hint text) returns boolean language plpgsql as $$
declare v_code text; v_hint text; v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_code = returned_sqlstate, v_hint = pg_exception_hint, v_msg = message_text;
    if v_code = p_code and (p_hint is null or v_hint = p_hint) then
      raise notice '      ↳ % / %: %', v_code, coalesce(v_hint, '-'), v_msg;
      return true;
    end if;
    raise notice '      ↳ UNEXPECTED % / %: %', v_code, coalesce(v_hint, '-'), v_msg;
    return false;
  end;
  raise notice '      ↳ no error raised';
  return false;
end $$;

create or replace function pg_temp.check(p_name text, p_ok boolean) returns void language plpgsql as $$
begin
  if p_ok then raise notice 'PASS  %', p_name;
  else raise exception 'FAIL  %', p_name; end if;
end $$;

-- start clean (a previous aborted run may have left rows behind) ----------------
delete from public.trademarks where serial_number like '9001-%' or serial_number like '9002-%';

-- actors ------------------------------------------------------------------------
insert into public.user_roles (user_id, role) values ('00000000-0000-4000-8000-00000000ad01', 'admin') on conflict do nothing;
insert into public.user_roles (user_id, role) values ('00000000-0000-4000-8000-00000000ad02', 'admin') on conflict do nothing;
-- 'viewer' is NOT an editing role (is_admin() = admin/editor only)
insert into public.user_roles (user_id, role) values ('00000000-0000-4000-8000-0000000000ee', 'viewer') on conflict do nothing;

-- seed through the real import path (Test 11 baseline) -------------------------
select pg_temp.as_user('00000000-0000-4000-8000-00000000ad01', 'authenticated', 'admin1@local.test');
set role authenticated;
select id as job_id from public.admin_create_import_job('excel', 'seed.xlsx', 3) \gset
select public.admin_import_trademark_rows(:'job_id'::uuid, jsonb_build_array(
  jsonb_build_object('serial_number', '9001-001', 'official_gazette_number', '9001', 'mark_name', 'OLD NAME',
                     'applicant_name', 'Alpha Trading', 'trademark_class', '25', 'application_type', 'Registration',
                     'publication_date', '2024-01-15', 'attorney_or_representative', 'Agent A', 'review_note', 'imported note',
                     'source_file', 'seed.xlsx', 'source_sheet', 'Sheet1', 'source_row', 2),
  jsonb_build_object('serial_number', '9001-002', 'official_gazette_number', '9001', 'mark_name', 'SECOND MARK',
                     'applicant_name', 'Beta Ltd', 'trademark_class', '30', 'source_file', 'seed.xlsx', 'source_sheet', 'Sheet1', 'source_row', 3),
  jsonb_build_object('serial_number', '9002-001', 'official_gazette_number', '9002', 'mark_name', 'THIRD MARK',
                     'applicant_name', 'Gamma GmbH', 'trademark_class', '5', 'source_file', 'seed.xlsx', 'source_sheet', 'Sheet1', 'source_row', 4)
)) as seed \gset
select pg_temp.check('seed imported 3 rows through admin_import_trademark_rows', (:'seed'::jsonb ->> 'inserted')::int = 3);
reset role;

select id as tm1 from public.trademarks where serial_number = '9001-001' \gset
select id as tm2 from public.trademarks where serial_number = '9001-002' \gset
-- two linked image rows (storage paths must stay as they are throughout)
insert into public.trademark_images (trademark_id, image_type, status, storage_path, thumbnail_path, gazette_number, serial_number, byte_size)
values (:'tm1'::uuid, 'logo', 'matched', '9001/9001-001-aaaaaaaaaaaa.png', 'thumbs/9001/9001-001.webp', '9001', '9001-001', 1000),
       (:'tm1'::uuid, 'mark_print', 'matched', '9001/9001-001-bbbbbbbbbbbb.png', null, '9001', '9001-001', 2000);
select count(*) as img_before from public.trademark_images where trademark_id = :'tm1'::uuid \gset
select pg_temp.col(:'tm1'::uuid, 'created_at') as created_before \gset
select pg_temp.col(:'tm1'::uuid, 'updated_at') as upd0 \gset
select pg_temp.col(:'tm1'::uuid, 'source_file') || '/' || pg_temp.col(:'tm1'::uuid, 'source_row') as prov0 \gset
select pg_temp.col(:'tm1'::uuid, 'created_by_job_id') || pg_temp.col(:'tm1'::uuid, 'import_job_id') as jobs0 \gset

-- Test 1 + 4: basic / multi-field edit (as admin1) ----------------------------------
set role authenticated;
select public.admin_update_trademark(:'tm1'::uuid,
         '{"mark_name": "  NEW NAME ", "applicant_name": "Alpha Trading LLC", "trademark_class": "25, 35", "review_comment": "checked against OG 9001 p.4"}'::jsonb,
         :'upd0'::timestamptz, 'spelling correction') as r1 \gset
reset role;
select pg_temp.check('T1 update reported', (:'r1'::jsonb ->> 'updated')::boolean);
select pg_temp.check('T1 changed list', (:'r1'::jsonb -> 'changed') = '["applicant_name","mark_name","review_comment","trademark_class"]'::jsonb);
select pg_temp.check('T1 returned row carries the new value', (:'r1'::jsonb -> 'trademark' ->> 'mark_name') = 'NEW NAME');
select pg_temp.check('T1 value trimmed + persisted', pg_temp.col(:'tm1'::uuid, 'mark_name') = 'NEW NAME');
select pg_temp.check('T4 all fields persisted', pg_temp.col(:'tm1'::uuid, 'applicant_name') || '|' || pg_temp.col(:'tm1'::uuid, 'trademark_class') || '|' || pg_temp.col(:'tm1'::uuid, 'review_comment')
                                                  = 'Alpha Trading LLC|25, 35|checked against OG 9001 p.4');
select pg_temp.check('T4 generated search columns follow', (pg_temp.tm(:'tm1'::uuid) -> 'class_numbers') = '[25, 35]'::jsonb);

-- §11: provenance + timestamps -------------------------------------------------------------
select pg_temp.check('§11 created_at unchanged', pg_temp.col(:'tm1'::uuid, 'created_at')::timestamptz = :'created_before'::timestamptz);
select pg_temp.check('§11 updated_at advanced', pg_temp.col(:'tm1'::uuid, 'updated_at')::timestamptz > :'upd0'::timestamptz);
select pg_temp.check('§11 source file/row provenance unchanged', pg_temp.col(:'tm1'::uuid, 'source_file') || '/' || pg_temp.col(:'tm1'::uuid, 'source_row') = :'prov0');
select pg_temp.check('§11 import job provenance unchanged', pg_temp.col(:'tm1'::uuid, 'created_by_job_id') || pg_temp.col(:'tm1'::uuid, 'import_job_id') = :'jobs0');
select pg_temp.check('§11 manual-edit provenance recorded', pg_temp.col(:'tm1'::uuid, 'manual_edited_by') = '00000000-0000-4000-8000-00000000ad01'
        and (pg_temp.tm(:'tm1'::uuid) -> 'manual_edit_fields') = '["applicant_name", "mark_name", "trademark_class"]'::jsonb);

-- Test 6: images untouched -----------------------------------------------------------------------
select pg_temp.check('T6 image rows intact', (select count(*) from public.trademark_images where trademark_id = :'tm1'::uuid) = :'img_before'::int);
select pg_temp.check('T6 storage paths intact', (select string_agg(storage_path, ',' order by storage_path) from public.trademark_images where trademark_id = :'tm1'::uuid)
                                                 = '9001/9001-001-aaaaaaaaaaaa.png,9001/9001-001-bbbbbbbbbbbb.png');
set role authenticated;
select jsonb_array_length(public.admin_get_trademark(:'tm1'::uuid) -> 'images') as img_api \gset
reset role;
select pg_temp.check('T6 admin_get_trademark still reports 2 images', :'img_api'::int = 2);

-- Test 3: public search finds the new name, not the old ---------------------------------------
select pg_temp.as_user('', 'anon', '');
set role anon;
select pg_temp.check('T3 public search finds NEW NAME', exists (select 1 from public.search_trademarks(p_query => 'new name') s where s.id = :'tm1'::uuid));
-- (exact mode: fuzzy matching would still rank "NEW NAME" for "old name" because they share a word — that is similarity, not stale data)
select pg_temp.check('T3 public search no longer finds OLD NAME (exact mode)', not exists (select 1 from public.search_trademarks(p_query => 'old name', p_fuzzy => false) s where s.id = :'tm1'::uuid));
select pg_temp.check('T3 result row shows the new mark name', (select s.mark_name from public.search_trademarks(p_query => 'new name') s where s.id = :'tm1'::uuid) = 'NEW NAME');
select pg_temp.check('T3 applicant search finds the new applicant', exists (select 1 from public.search_trademarks(p_applicant => 'Alpha Trading LLC') s where s.id = :'tm1'::uuid));
reset role;
select pg_temp.check('T7 admin-only columns are not in the public column grant', (select count(*) from information_schema.column_privileges
        where table_schema = 'public' and table_name = 'trademarks' and grantee in ('anon','authenticated') and privilege_type = 'SELECT'
          and column_name in ('review_comment','review_note','attorney_or_representative','manual_edit_fields','manual_edited_by','manual_edited_at')) = 0);

-- Test 12: audit trail ---------------------------------------------------------------------------
select pg_temp.check('T12 audit_logs UPDATE row with actor + old/new', exists (
  select 1 from public.audit_logs a where a.table_name = 'trademarks' and a.row_id = :'tm1'::text and a.action = 'UPDATE'
     and a.actor_id = '00000000-0000-4000-8000-00000000ad01'
     and a.changed_fields -> 'mark_name' = '{"old": "OLD NAME", "new": "NEW NAME"}'::jsonb));
select pg_temp.check('T12 admin_actions trademarks.edit with actor e-mail, reason, before/after', exists (
  select 1 from public.admin_actions x where x.action = 'trademarks.edit' and :'tm1'::text = any (x.target_ids)
     and x.actor_email = 'admin1@local.test' and x.details ->> 'reason' = 'spelling correction'
     and x.details -> 'before' ->> 'mark_name' = 'OLD NAME' and x.details -> 'after' ->> 'mark_name' = 'NEW NAME'));
select pg_temp.check('T12 audit rows are immutable (even for the owner)', pg_temp.expect_error('delete from public.audit_logs where table_name = ''trademarks''', '42501', null));
select pg_temp.check('T12 admin_actions rows are immutable', pg_temp.expect_error('update public.admin_actions set details = ''{}'' where action = ''trademarks.edit''', '42501', null));

-- Test 2: a different administrator session reads the persisted value ---------------------------
select pg_temp.as_user('00000000-0000-4000-8000-00000000ad02', 'authenticated', 'admin2@local.test');
set role authenticated;
select public.admin_get_trademark(:'tm1'::uuid) -> 'trademark' ->> 'mark_name' as seen_by_admin2 \gset
reset role;
select pg_temp.check('T2 another admin session reads NEW NAME', :'seen_by_admin2' = 'NEW NAME');

-- Test 10: concurrency — a stale expected_updated_at is rejected, nothing overwritten --------------
set role authenticated;
select pg_temp.check('T10 stale update rejected (PT409 / stale)', pg_temp.expect_error(
  format('select public.admin_update_trademark(%L, %L, %L, null)', :'tm1', '{"mark_name": "RACE LOSER"}', :'upd0'), 'PT409', 'stale'));
reset role;
select pg_temp.check('T10 newer value survived', pg_temp.col(:'tm1'::uuid, 'mark_name') = 'NEW NAME');
select pg_temp.col(:'tm1'::uuid, 'updated_at') as upd1 \gset
set role authenticated;
select (public.admin_update_trademark(:'tm1'::uuid, '{"mark_print": "NEW NAME (device)"}'::jsonb, :'upd1'::timestamptz) ->> 'updated')::boolean as ok10 \gset
reset role;
select pg_temp.check('T10 fresh expected_updated_at accepted', :'ok10'::boolean);

-- Test 9: validation + duplicate identifiers ------------------------------------------------------
set role authenticated;
select pg_temp.check('T9 unknown field rejected', pg_temp.expect_error(format('select public.admin_update_trademark(%L, %L)', :'tm1', '{"source_file": "hack.xlsx"}'), '22023', null));
select pg_temp.check('T9 id / created_at not editable', pg_temp.expect_error(format('select public.admin_update_trademark(%L, %L)', :'tm1', '{"created_at": "2000-01-01"}'), '22023', null));
select pg_temp.check('T9 bad date format rejected', pg_temp.expect_error(format('select public.admin_update_trademark(%L, %L)', :'tm1', '{"publication_date": "15/01/2024"}'), '22023', null));
select pg_temp.check('T9 impossible date rejected', pg_temp.expect_error(format('select public.admin_update_trademark(%L, %L)', :'tm1', '{"publication_date": "2024-02-30"}'), '22023', null));
select pg_temp.check('T9 bad review_status rejected', pg_temp.expect_error(format('select public.admin_update_trademark(%L, %L)', :'tm1', '{"review_status": "approved"}'), '22023', null));
select pg_temp.check('T9 empty serial rejected', pg_temp.expect_error(format('select public.admin_update_trademark(%L, %L)', :'tm1', '{"serial_number": "   "}'), '23502', null));
select pg_temp.check('T9 duplicate (gazette, serial) rejected (PT409 / duplicate)', pg_temp.expect_error(format('select public.admin_update_trademark(%L, %L)', :'tm1', '{"serial_number": "9001-002"}'), 'PT409', 'duplicate'));
select pg_temp.check('T9 unknown record id → P0002', pg_temp.expect_error(format('select public.admin_update_trademark(%L, %L)', '00000000-0000-4000-8000-0000000dead0', '{"mark_name": "x"}'), 'P0002', null));
reset role;
select pg_temp.check('T9 still 3 records — no second record created', (select count(*) from public.trademarks where serial_number like '900%') = 3);

-- §5: identifier change keeps the same database identity; image rows follow by id ------------------
select pg_temp.col(:'tm1'::uuid, 'updated_at') as upd2 \gset
set role authenticated;
select public.admin_update_trademark(:'tm1'::uuid, '{"serial_number": "9001-001A"}'::jsonb, :'upd2'::timestamptz) as r5 \gset
reset role;
select pg_temp.check('§5 serial changed on the same id', pg_temp.col(:'tm1'::uuid, 'serial_number') = '9001-001A' and (:'r5'::jsonb -> 'trademark' ->> 'id') = :'tm1');
select pg_temp.check('§5 image rows still linked, labels refreshed, storage paths unchanged',
  (select count(*) filter (where serial_number = '9001-001A' and storage_path like '9001/9001-001-%') from public.trademark_images where trademark_id = :'tm1'::uuid) = 2);

-- Test 5: unchanged values → nothing written ---------------------------------------------------------
select pg_temp.col(:'tm1'::uuid, 'updated_at') as upd_t5 \gset
set role authenticated;
select (public.admin_update_trademark(:'tm1'::uuid, '{"mark_name": "NEW NAME"}'::jsonb) ->> 'updated')::boolean as noop \gset
reset role;
select pg_temp.check('T5 unchanged values → no write, updated_at untouched', :'noop'::boolean = false and pg_temp.col(:'tm1'::uuid, 'updated_at')::timestamptz = :'upd_t5'::timestamptz);

-- Test 7: administrator-only fields editable, still restricted -------------------------------------
select pg_temp.col(:'tm1'::uuid, 'updated_at') as upd3 \gset
set role authenticated;
select public.admin_update_trademark(:'tm1'::uuid, '{"review_note": "verify class 35 with applicant", "attorney_or_representative": "Agent B"}'::jsonb, :'upd3'::timestamptz) -> 'changed' as ch7 \gset
reset role;
select pg_temp.check('T7 internal note + attorney saved', :'ch7'::jsonb = '["attorney_or_representative","review_note"]'::jsonb
        and pg_temp.col(:'tm1'::uuid, 'review_note') = 'verify class 35 with applicant');
select pg_temp.as_user('', 'anon', '');
set role anon;
select pg_temp.check('T7 anon cannot read review_note through the table', pg_temp.expect_error(format('select review_note from public.trademarks where id = %L', :'tm1'), '42501', null));
select pg_temp.check('T7 anon cannot call admin_get_trademark', pg_temp.expect_error(format('select public.admin_get_trademark(%L)', :'tm1'), '42501', null));
reset role;

-- Test 8: permissions are enforced by the database ---------------------------------------------------
set role anon;
select pg_temp.check('T8 anon cannot execute admin_update_trademark', pg_temp.expect_error(format('select public.admin_update_trademark(%L, %L)', :'tm1', '{"mark_name": "HACKED"}'), '42501', null));
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ee', 'authenticated', 'viewer@local.test');
set role authenticated;
select pg_temp.check('T8 signed-in viewer (no admin/editor role) rejected', pg_temp.expect_error(format('select public.admin_update_trademark(%L, %L)', :'tm1', '{"mark_name": "HACKED"}'), '42501', null));
with upd as (update public.trademarks set mark_name = 'HACKED' where id = :'tm1'::uuid returning 1) select count(*) as direct_rows from upd \gset
reset role;
select pg_temp.check('T8 signed-in viewer cannot update the table directly (RLS)', :'direct_rows'::int = 0);
select pg_temp.as_user('00000000-0000-4000-8000-00000000ff01', 'authenticated', 'nobody@local.test');
set role authenticated;
select pg_temp.check('T8 signed-in user without any role rejected', pg_temp.expect_error(format('select public.admin_update_trademark(%L, %L)', :'tm1', '{"mark_name": "HACKED"}'), '42501', null));
reset role;
select pg_temp.check('T8 value still NEW NAME', pg_temp.col(:'tm1'::uuid, 'mark_name') = 'NEW NAME');

-- Test 11: re-importing the original Excel keeps the manual corrections -------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-00000000ad01', 'authenticated', 'admin1@local.test');
set role authenticated;
select id as job2 from public.admin_create_import_job('excel', 'seed.xlsx', 2) \gset
select public.admin_import_trademark_rows(:'job2'::uuid, jsonb_build_array(
  jsonb_build_object('serial_number', '9001-001A', 'official_gazette_number', '9001', 'mark_name', 'OLD NAME',
                     'applicant_name', 'Alpha Trading', 'trademark_class', '25', 'application_type', 'Registration',
                     'publication_date', '2024-01-15', 'attorney_or_representative', 'Agent A', 'review_note', 'imported note',
                     'goods_and_services', 'Clothing', 'source_file', 'seed.xlsx', 'source_sheet', 'Sheet1', 'source_row', 2),
  jsonb_build_object('serial_number', '9001-002', 'official_gazette_number', '9001', 'mark_name', 'SECOND MARK RENAMED',
                     'applicant_name', 'Beta Ltd', 'trademark_class', '30', 'source_file', 'seed.xlsx', 'source_sheet', 'Sheet1', 'source_row', 3)
)) as reimp \gset
reset role;
select pg_temp.check('T11 re-import ran (2 updated, 0 failed)', (:'reimp'::jsonb ->> 'updated')::int = 2 and (:'reimp'::jsonb ->> 'failed')::int = 0);
select pg_temp.check('T11 manually corrected fields kept', pg_temp.col(:'tm1'::uuid, 'mark_name') || '|' || pg_temp.col(:'tm1'::uuid, 'applicant_name') || '|' || pg_temp.col(:'tm1'::uuid, 'trademark_class')
        || '|' || pg_temp.col(:'tm1'::uuid, 'review_note') || '|' || pg_temp.col(:'tm1'::uuid, 'attorney_or_representative')
        = 'NEW NAME|Alpha Trading LLC|25, 35|verify class 35 with applicant|Agent B');
select pg_temp.check('T11 non-corrected column still imports', pg_temp.col(:'tm1'::uuid, 'goods_and_services') = 'Clothing');
select pg_temp.check('T11 never-edited record imports exactly as before', pg_temp.col(:'tm2'::uuid, 'mark_name') = 'SECOND MARK RENAMED');
select pg_temp.check('T11 preserved fields reported to the Import Center', (:'reimp'::jsonb ->> 'preserved')::int = 5 and (:'reimp'::jsonb ->> 'preserved_rows')::int = 1);
select pg_temp.check('T11 import item lists the kept fields', exists (
  select 1 from public.import_job_items i where i.job_id = :'job2'::uuid and i.item_ref = '9001-001A' and i.status = 'updated'
     and i.payload -> 'preserved' = '["applicant_name","attorney_or_representative","mark_name","review_note","trademark_class"]'::jsonb
     and i.message like 'Manually corrected field(s) kept:%'));
select pg_temp.check('T11 last-import provenance moved to the new job, creation job kept',
        pg_temp.col(:'tm1'::uuid, 'import_job_id') = :'job2' and pg_temp.col(:'tm1'::uuid, 'created_by_job_id') = :'job_id');
select pg_temp.check('T11 image rows still intact after the import', (select count(*) from public.trademark_images where trademark_id = :'tm1'::uuid) = 2);

-- releasing the protection lets the next import overwrite again -----------------------------------------
select pg_temp.col(:'tm1'::uuid, 'updated_at') as upd4 \gset
set role authenticated;
select (public.admin_update_trademark(:'tm1'::uuid, '{}'::jsonb, :'upd4'::timestamptz, 'release', true) ->> 'updated')::boolean as released \gset
select id as job3 from public.admin_create_import_job('excel', 'seed.xlsx', 1) \gset
select public.admin_import_trademark_rows(:'job3'::uuid, jsonb_build_array(
  jsonb_build_object('serial_number', '9001-001A', 'official_gazette_number', '9001', 'mark_name', 'OLD NAME'))) as reimp3 \gset
reset role;
select pg_temp.check('release: protection cleared', :'released'::boolean and (pg_temp.tm(:'tm1'::uuid) -> 'manual_edit_fields') = '[]'::jsonb);
select pg_temp.check('release: the Excel value applies again', pg_temp.col(:'tm1'::uuid, 'mark_name') = 'OLD NAME');

-- cleanup (local DB only) ------------------------------------------------------------------------------
delete from public.trademarks where serial_number like '9001-%' or serial_number like '9002-%';
delete from public.import_jobs where id in (:'job_id'::uuid, :'job2'::uuid, :'job3'::uuid);
delete from public.user_roles where user_id in ('00000000-0000-4000-8000-0000000000ee', '00000000-0000-4000-8000-00000000ad02');
\o
\echo ALL CHECKS PASSED
