-- =============================================================================
-- LOCAL DEV ONLY — scenario tests for migration 1300 (intelligent image search
-- without a vision service: text-only rows, 'skipped' status, engine column,
-- re-queue of skipped images, public counts). Runs against the local stack
-- (scripts/local-stack/start.sh), never against production:
--   psql -h /tmp -p 54329 -U postgres -d afg_registry -v ON_ERROR_STOP=1 \
--        -f supabase/dev/test_1300_image_analysis_zero_cost.sql
-- Uses the reserved local serial range 9004-* and deletes its rows at the end.
-- Run test_1200_intelligent_image_search.sql as well: 1300 must not break it.
-- =============================================================================
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
\o /dev/null

create or replace function pg_temp.as_user(p_sub text, p_role text, p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_sub, 'role', p_role, 'email', p_email)::text, false);
  perform set_config('request.jwt.claim.sub', p_sub, false);
  perform set_config('request.jwt.claim.role', p_role, false);
end $$;
create or replace function pg_temp.check(p_name text, p_ok boolean) returns void language plpgsql as $$
begin
  if p_ok then raise notice 'PASS  %', p_name; else raise exception 'FAIL  %', p_name; end if;
end $$;
create or replace function pg_temp.expect_error(p_sql text, p_code text) returns boolean language plpgsql as $$
declare v_code text; v_msg text;
begin
  begin execute p_sql;
  exception when others then
    get stacked diagnostics v_code = returned_sqlstate, v_msg = message_text;
    if v_code = p_code then raise notice '      ↳ %: %', v_code, v_msg; return true; end if;
    raise notice '      ↳ UNEXPECTED %: %', v_code, v_msg; return false;
  end;
  raise notice '      ↳ no error raised'; return false;
end $$;
create or replace function pg_temp.row_of(p_serial text) returns public.trademark_image_analysis language sql security definer as $$
  select a.* from public.trademark_image_analysis a join public.trademark_images i on i.id = a.image_id where i.serial_number = p_serial
$$;
create or replace function pg_temp.pending(p_model text, p_retry boolean, p_skipped boolean) returns bigint language sql security definer as $$
  select count(*) from public.admin_image_analysis_pending(p_model, 500, p_retry, p_skipped) p
    join public.trademark_images i on i.id = p.id where i.serial_number like '9004-%'
$$;
create or replace function pg_temp.rows_for(p_serial text) returns bigint language sql security definer as $$
  select count(*) from public.trademark_image_analysis a join public.trademark_images i on i.id = a.image_id where i.serial_number = p_serial
$$;
create or replace function pg_temp.img(p_serial text) returns uuid language sql security definer as $$
  select id from public.trademark_images where serial_number = p_serial
$$;

-- start clean ------------------------------------------------------------------
delete from public.trademarks where serial_number like '9004-%';

-- seed: a word mark, a Persian word mark, a symbol-only mark, an unpublished mark
insert into public.trademarks (serial_number, official_gazette_number, mark_name, applicant_name, trademark_class, application_type, is_published)
values ('9004-001', '9004', 'PAMIR TEA', 'Pamir Trading', '30', 'Registration', true),
       ('9004-002', '9004', 'بهار', 'Bahar Foods', '29', 'Registration', true),
       ('9004-003', '9004', 'EAGLE DEVICE', 'Symbol Co', '25', 'Registration', true),
       ('9004-004', '9004', 'PAMIR HIDDEN', 'Hidden', '30', 'Registration', false);
insert into public.trademark_images (trademark_id, image_type, status, storage_path, gazette_number, serial_number, width, height, byte_size, content_type)
select t.id, 'logo', 'matched', '9004/' || t.serial_number || '.png', '9004', t.serial_number, 100, 100, 10, 'image/png'
  from public.trademarks t where t.serial_number like '9004-%';

\o
\echo '--- 1300 image analysis without a vision service'
\o /dev/null

-- 1. schema ---------------------------------------------------------------------
select pg_temp.check('engine column exists',
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trademark_image_analysis' and column_name = 'engine'));
select pg_temp.check('status check accepts skipped',
  (select pg_get_constraintdef(oid) like '%skipped%' from pg_constraint where conname = 'trademark_image_analysis_status_check'));
select pg_temp.check('exactly one admin_image_analysis_pending signature (PostgREST can resolve it)',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'admin_image_analysis_pending') = 1);

-- 2. authorisation unchanged ----------------------------------------------------
select pg_temp.as_user(null, 'anon', null);
set role anon;
select pg_temp.check('anon cannot call the 4-argument pending function',
  pg_temp.expect_error($$select count(*) from public.admin_image_analysis_pending('tess', 10, false, false)$$, '42501'));
select pg_temp.check('anon can read the public status', (public.hybrid_image_search_status('tess') ? 'images_skipped'));
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ee', 'authenticated', 'nobody@example.org');
set role authenticated;
select pg_temp.check('non-admin cannot upsert analysis rows',
  pg_temp.expect_error($$select public.admin_upsert_image_analysis('tess', '[]'::jsonb)$$, '42501'));
reset role;

-- 3. browser / offline indexer flow (admin) -------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-00000000ad01', 'authenticated', 'local-admin@tmistan.local');
set role authenticated;
select pg_temp.check('all 4 seeded images pending for a fresh model', pg_temp.pending('tess', false, false) = 4);

-- text-only rows (no embedding) + one skipped (symbol-only) + engine recorded
select public.admin_upsert_image_analysis('tess', jsonb_build_array(
  jsonb_build_object('image_id', pg_temp.img('9004-001'), 'status', 'indexed', 'ocr_text', 'PAMIR TEA', 'ocr_confidence', 91.5,
                     'ocr_words', '[{"text":"PAMIR","normalized":"pamir","confidence":93,"script":"latin","lang":"eng"},{"text":"TEA","normalized":"tea","confidence":90,"script":"latin","lang":"eng"}]'::jsonb,
                     'ocr_scripts', '["latin"]'::jsonb, 'warnings', '[]'::jsonb, 'duration_ms', 1800, 'engine', 'tesseract.js@7.0.0'),
  jsonb_build_object('image_id', pg_temp.img('9004-002'), 'status', 'indexed', 'ocr_text', 'بهار', 'ocr_confidence', 80,
                     'ocr_words', '[{"text":"بهار","normalized":"بهار","confidence":80,"script":"arabic","lang":"fas+pus"}]'::jsonb,
                     'ocr_scripts', '["arabic"]'::jsonb, 'duration_ms', 2100, 'engine', 'tesseract 5.5.0'),
  jsonb_build_object('image_id', pg_temp.img('9004-003'), 'status', 'skipped', 'warnings', '["no_text"]'::jsonb, 'duration_ms', 2400, 'engine', 'tesseract.js@7.0.0'),
  jsonb_build_object('image_id', pg_temp.img('9004-004'), 'status', 'indexed', 'ocr_text', 'PAMIR HIDDEN', 'ocr_confidence', 88, 'engine', 'tesseract.js@7.0.0')
)) as r \gset
select pg_temp.check('upsert reports 3 indexed / 1 skipped / 0 failed',
  (:'r'::jsonb ->> 'indexed') = '3' and (:'r'::jsonb ->> 'skipped') = '1' and (:'r'::jsonb ->> 'failed') = '0');
select pg_temp.check('text-only row stored without an embedding',
  (select (r).embedding is null and (r).ocr_text = 'PAMIR TEA' and (r).ocr_text_normalized = 'pamir tea' from pg_temp.row_of('9004-001') r));
select pg_temp.check('engine recorded per row',
  (select (r).engine = 'tesseract 5.5.0' from pg_temp.row_of('9004-002') r));
select pg_temp.check('skipped row keeps no text and records the warning',
  (select (r).status = 'skipped' and (r).ocr_text is null and (r).warnings = array['no_text'] from pg_temp.row_of('9004-003') r));
select pg_temp.check('nothing pending afterwards (skipped is not pending)', pg_temp.pending('tess', false, false) = 0);
select pg_temp.check('skipped image is re-queued with p_include_skipped', pg_temp.pending('tess', false, true) = 1);
select pg_temp.check('3-argument call still works (1200 clients)',
  (select count(*) from public.admin_image_analysis_pending('tess', 500, false)) >= 0);

-- admin status: counts + pending formula
select public.admin_image_analysis_status('tess') as s \gset
select pg_temp.check('admin status reports indexed/with_text/skipped/pending',
  (:'s'::jsonb ->> 'indexed')::int >= 3 and (:'s'::jsonb ->> 'with_text')::int >= 3 and (:'s'::jsonb ->> 'skipped')::int >= 1
  and (:'s'::jsonb ->> 'pending')::int = (:'s'::jsonb ->> 'matched_images')::int - (:'s'::jsonb ->> 'indexed')::int - (:'s'::jsonb ->> 'failed')::int - (:'s'::jsonb ->> 'skipped')::int);

-- validation of the new status value
select pg_temp.check('indexed without text and without embedding is still rejected (item-level)',
  (public.admin_upsert_image_analysis('tess', jsonb_build_array(jsonb_build_object('image_id', pg_temp.img('9004-003'), 'status', 'indexed'))) ->> 'failed') = '1');
select pg_temp.check('unknown status is rejected (item-level)',
  (public.admin_upsert_image_analysis('tess', jsonb_build_array(jsonb_build_object('image_id', pg_temp.img('9004-003'), 'status', 'maybe'))) ->> 'failed') = '1');
select pg_temp.check('ocr_words that is not an array is dropped, row still stored',
  (public.admin_upsert_image_analysis('tess', jsonb_build_array(jsonb_build_object('image_id', pg_temp.img('9004-001'), 'status', 'indexed', 'ocr_text', 'PAMIR TEA', 'ocr_words', '"x"'::jsonb))) ->> 'indexed') = '1'
  and (select (r).ocr_words is null from pg_temp.row_of('9004-001') r));

-- idempotency: re-running the same item updates the row, never duplicates it
select public.admin_upsert_image_analysis('tess', jsonb_build_array(
  jsonb_build_object('image_id', pg_temp.img('9004-001'), 'status', 'indexed', 'ocr_text', 'PAMIR TEA', 'ocr_confidence', 92, 'engine', 'tesseract.js@7.0.0'))) as r2 \gset
select pg_temp.check('re-run keeps one row per image and counts attempts',
  pg_temp.rows_for('9004-001') = 1
  and (select (r).attempts from pg_temp.row_of('9004-001') r) = 3);

-- re-analysing a skipped image that now yields text promotes it to indexed
select public.admin_upsert_image_analysis('tess', jsonb_build_array(
  jsonb_build_object('image_id', pg_temp.img('9004-003'), 'status', 'indexed', 'ocr_text', 'EAGLE', 'ocr_confidence', 70, 'engine', 'tesseract.js@7.0.0'))) as r3 \gset
select pg_temp.check('skipped → indexed on re-analysis', (select (r).status = 'indexed' and (r).ocr_text = 'EAGLE' from pg_temp.row_of('9004-003') r));
-- and back to skipped clears the text
select public.admin_upsert_image_analysis('tess', jsonb_build_array(
  jsonb_build_object('image_id', pg_temp.img('9004-003'), 'status', 'skipped', 'ocr_text', 'ignored', 'engine', 'tesseract.js@7.0.0'))) as r4 \gset
select pg_temp.check('indexed → skipped clears stored text', (select (r).status = 'skipped' and (r).ocr_text is null from pg_temp.row_of('9004-003') r));
reset role;

-- 4. public search with text-only rows (what the browser sends: no embedding) ---
select pg_temp.as_user(null, 'anon', null);
set role anon;
select public.hybrid_image_search_status('tess') as p \gset
select pg_temp.check('public status: text available, visual not, skipped + matched counts present',
  (:'p'::jsonb ->> 'text_available')::boolean and not (:'p'::jsonb ->> 'visual_available')::boolean
  and (:'p'::jsonb ->> 'images_skipped')::int >= 1 and (:'p'::jsonb ->> 'matched_images')::int >= 3
  and (:'p'::jsonb ->> 'analysed_images')::int = (:'p'::jsonb ->> 'indexed_images')::int + (:'p'::jsonb ->> 'images_skipped')::int);
select pg_temp.check('public status never counts the unpublished record',
  (select count(*) from public.search_trademarks_hybrid(p_terms => array['PAMIR'], p_model => 'tess') where serial_number = '9004-004') = 0);
select pg_temp.check('query words only (no embedding): exact mark first',
  (select serial_number = '9004-001' and 'text_exact' = any(match_types)
     from public.search_trademarks_hybrid(p_embedding => null, p_terms => array['PAMIR', 'TEA'], p_model => 'tess') limit 1));
select pg_temp.check('Persian query matches the stored OCR text of the Persian mark',
  exists (select 1 from public.search_trademarks_hybrid(p_terms => array['بهار'], p_model => 'tess') where serial_number = '9004-002'));
select pg_temp.check('transliteration variant of a Persian word is searchable as a lower-weight variant',
  exists (select 1 from public.search_trademarks_hybrid(p_terms => array['بهار'], p_variants => array['bahar'], p_model => 'tess') where serial_number = '9004-002'));
select pg_temp.check('empty query (no words, no vectors) is rejected with 22023, never returns everything',
  pg_temp.expect_error($$select count(*) from public.search_trademarks_hybrid(p_model => 'tess')$$, '22023'));
select pg_temp.check('a skipped image contributes no OCR evidence (mark name still matches)',
  exists (select 1 from public.search_trademarks_hybrid(p_terms => array['EAGLE'], p_model => 'tess')
           where serial_number = '9004-003' and not ('ocr_text' = any(match_types))));
reset role;

-- cleanup -----------------------------------------------------------------------
delete from public.trademarks where serial_number like '9004-%';
select pg_temp.check('cleanup removed the test rows (cascade to analysis)',
  (select count(*) from public.trademarks where serial_number like '9004-%') = 0);
\o
\echo '--- 1300 done'
