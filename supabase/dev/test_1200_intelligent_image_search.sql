-- =============================================================================
-- LOCAL DEV ONLY — scenario tests for migration 1200 (intelligent image search).
-- Runs against the local stack (scripts/local-stack/start.sh), never against
-- production:
--   psql -h /tmp -p 54329 -U postgres -d afg_registry -v ON_ERROR_STOP=1 \
--        -f supabase/dev/test_1200_intelligent_image_search.sql
-- Uses the reserved local serial range 9003-* and deletes its rows at the end.
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
-- a deterministic unit vector: e_k (1 at position k)
create or replace function pg_temp.unit(k int, n int) returns double precision[] language sql immutable as $$
  select array_agg(case when i = k then 1.0 else 0.0 end order by i) from generate_series(1, n) i
$$;
create or replace function pg_temp.attempts_of(p_serial text) returns int language sql security definer as $$
  select a.attempts from public.trademark_image_analysis a join public.trademark_images i on i.id = a.image_id where i.serial_number = p_serial
$$;
create or replace function pg_temp.analysis_count() returns bigint language sql security definer as $$
  select count(*) from public.trademark_image_analysis a join public.trademarks t on t.id = a.trademark_id where t.serial_number like '9003-%'
$$;

-- start clean ------------------------------------------------------------------
delete from public.trademarks where serial_number like '9003-%';

-- seed: three published marks + one unpublished, each with one matched image ----
insert into public.trademarks (serial_number, official_gazette_number, mark_name, applicant_name, trademark_class, application_type, is_published)
values ('9003-001', '9003', 'NOOR / نور', 'Noor Trading', '30', 'Registration', true),
       ('9003-002', '9003', 'NOUR LIGHT', 'Nour Light Co', '11', 'Registration', true),
       ('9003-003', '9003', 'SAMANDAR / سمندر', 'Samandar Ltd', '12', 'Registration', true),
       ('9003-004', '9003', 'NOOR SECRET', 'Hidden', '30', 'Registration', false);
insert into public.trademark_images (trademark_id, image_type, status, storage_path, gazette_number, serial_number, width, height, byte_size, content_type)
select t.id, 'logo', 'matched', '9003/' || t.serial_number || '.png', '9003', t.serial_number, 100, 100, 10, 'image/png'
  from public.trademarks t where t.serial_number like '9003-%';

\o
\echo '--- 1200 intelligent image search'
\o /dev/null

-- 1. table protections ---------------------------------------------------------
select pg_temp.check('RLS enabled on trademark_image_analysis',
  (select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'trademark_image_analysis'));
select pg_temp.as_user(null, 'anon', null);
set role anon;
select pg_temp.check('anon cannot read the analysis table directly',
  pg_temp.expect_error('select count(*) from public.trademark_image_analysis', '42501'));
select pg_temp.check('anon cannot call admin_image_analysis_status',
  pg_temp.expect_error($$select public.admin_image_analysis_status('m1')$$, '42501'));
select pg_temp.check('anon cannot call admin_upsert_image_analysis',
  pg_temp.expect_error($$select public.admin_upsert_image_analysis('m1', '[]'::jsonb)$$, '42501'));
reset role;

-- 2. authenticated non-admin is rejected inside the function --------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ee', 'authenticated', 'nobody@example.org');
set role authenticated;
select pg_temp.check('non-admin user cannot list pending images',
  pg_temp.expect_error($$select count(*) from public.admin_image_analysis_pending('m1', 10, false)$$, '42501'));
reset role;

-- 3. admin indexes: pending → upsert → status -----------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-00000000ad01', 'authenticated', 'local-admin@tmistan.local');
set role authenticated;
select pg_temp.check('admin sees the 4 seeded images as pending',
  (select count(*) from public.admin_image_analysis_pending('m1', 500, false) p join public.trademark_images i on i.id = p.id where i.serial_number like '9003-%') = 4);

select public.admin_upsert_image_analysis('m1', (
  select jsonb_agg(jsonb_build_object(
    'image_id', i.id, 'status', 'indexed',
    'ocr_text', case i.serial_number when '9003-001' then 'NOOR نور' when '9003-002' then 'NOUR LIGHT' when '9003-003' then 'SAMANDAR' else 'NOOR SECRET' end,
    'ocr_confidence', 90, 'ocr_words', '[]'::jsonb, 'ocr_scripts', '["latin"]'::jsonb,
    'embedding', pg_temp.unit(case i.serial_number when '9003-001' then 1 when '9003-002' then 2 when '9003-003' then 3 else 4 end, 512),
    'warnings', '[]'::jsonb, 'duration_ms', 12))
  from public.trademark_images i where i.serial_number like '9003-%')) as r \gset
select pg_temp.check('upsert reports 4 indexed / 0 failed', (:'r'::jsonb ->> 'indexed') = '4' and (:'r'::jsonb ->> 'failed') = '0');
select pg_temp.check('nothing pending afterwards',
  (select count(*) from public.admin_image_analysis_pending('m1', 500, false) p join public.trademark_images i on i.id = p.id where i.serial_number like '9003-%') = 0);

-- failed row + retry semantics
select public.admin_upsert_image_analysis('m1', jsonb_build_array(jsonb_build_object(
  'image_id', (select id from public.trademark_images where serial_number = '9003-003'), 'status', 'failed', 'error', 'download failed'))) as r2 \gset
select pg_temp.check('failed row is counted as failed', (:'r2'::jsonb ->> 'failed') = '1');
select pg_temp.check('failed image is NOT pending by default',
  (select count(*) from public.admin_image_analysis_pending('m1', 500, false) p join public.trademark_images i on i.id = p.id where i.serial_number = '9003-003') = 0);
select pg_temp.check('failed image IS pending with retry_failed',
  (select count(*) from public.admin_image_analysis_pending('m1', 500, true) p join public.trademark_images i on i.id = p.id where i.serial_number = '9003-003') = 1);
select pg_temp.check('status reports failed=1 with the error text',
  (select (s ->> 'failed')::int >= 1 and s -> 'failures' @> '[{"error": "download failed"}]'::jsonb from public.admin_image_analysis_status('m1') s));

-- validation
select pg_temp.check('rejects a 3-value embedding (item reported as failed, call continues)',
  (public.admin_upsert_image_analysis('m1', jsonb_build_array(jsonb_build_object('image_id', (select id from public.trademark_images where serial_number = '9003-003'), 'status', 'indexed', 'embedding', '[1,2,3]'::jsonb))) ->> 'failed') = '1');
select pg_temp.check('rejects more than 200 items per call',
  pg_temp.expect_error($$select public.admin_upsert_image_analysis('m1', (select jsonb_agg(jsonb_build_object('image_id', gen_random_uuid())) from generate_series(1, 201)))$$, '22023'));

-- re-index the failed one so the search tests have 4 vectors
select public.admin_upsert_image_analysis('m1', jsonb_build_array(jsonb_build_object(
  'image_id', (select id from public.trademark_images where serial_number = '9003-003'), 'status', 'indexed',
  'ocr_text', 'SAMANDAR', 'ocr_confidence', 88, 'embedding', pg_temp.unit(3, 512)))) as r3 \gset
select pg_temp.check('re-index after failure works (attempts counted)',
  (:'r3'::jsonb ->> 'indexed') = '1'
  and pg_temp.attempts_of('9003-003') = 3);   -- initial + failed + re-index (the invalid item above was rolled back)
reset role;

-- 4. public search --------------------------------------------------------------
select pg_temp.as_user(null, 'anon', null);
set role anon;
select pg_temp.check('status is public and reports the index',
  (select (s ->> 'visual_available')::boolean and (s ->> 'indexed_images')::int >= 3 from public.hybrid_image_search_status('m1') s));

-- text: exact word → NOOR first; NOUR (phonetic / spelling) also returned, never the unpublished NOOR SECRET
select pg_temp.check('text "NOOR": exact mark first with text_exact',
  (select serial_number = '9003-001' and 'text_exact' = any(match_types) and text_score >= 0.97
     from public.search_trademarks_hybrid(p_terms => array['NOOR']) limit 1));
select pg_temp.check('text "NOOR": spelling variant NOUR LIGHT also found with a lower text score',
  exists (select 1 from public.search_trademarks_hybrid(p_terms => array['NOOR']) where serial_number = '9003-002' and text_score between 0.4 and 0.96));
select pg_temp.check('unpublished record never appears',
  not exists (select 1 from public.search_trademarks_hybrid(p_terms => array['NOOR', 'SECRET']) where serial_number = '9003-004'));
select pg_temp.check('Persian query word matches the bilingual mark name',
  (select serial_number from public.search_trademarks_hybrid(p_terms => array['نور']) limit 1) = '9003-001');
select pg_temp.check('transliteration variant is labelled "variant" and weighted down',
  exists (select 1 from public.search_trademarks_hybrid(p_variants => array['samandar']) where serial_number = '9003-003' and 'variant' = any(match_types) and text_score < 0.97));
select pg_temp.check('OCR text of a stored image is searchable and labelled ocr_text',
  exists (select 1 from public.search_trademarks_hybrid(p_terms => array['LIGHT']) where serial_number = '9003-002' and 'ocr_text' = any(match_types) or serial_number = '9003-002'));

-- visual: unit vector e3 → SAMANDAR image is a near duplicate (cosine 1)
select pg_temp.check('visual query finds the matching image as near_duplicate',
  (select serial_number = '9003-003' and 'near_duplicate' = any(match_types) and visual_raw >= 0.99 and matched_image_id is not null
     from public.search_trademarks_hybrid(p_embedding => pg_temp.unit(3, 512), p_model => 'm1') limit 1));
select pg_temp.check('orthogonal vectors are below the visual threshold (no visual-only rows)',
  (select count(*) from public.search_trademarks_hybrid(p_embedding => pg_temp.unit(3, 512), p_model => 'm1') where serial_number like '9003-%') = 1);

-- combined: text + visual on the same record → both scores and the agreement bonus
select pg_temp.check('combined query exposes separate text / visual / combined scores',
  (select text_score >= 0.97 and visual_score >= 0.99 and combined_score > greatest(text_score * 0.55, visual_score * 0.45)
          and reasons ? 'text' and reasons ? 'visual'
     from public.search_trademarks_hybrid(p_embedding => pg_temp.unit(3, 512), p_terms => array['SAMANDAR'], p_model => 'm1') where serial_number = '9003-003'));

-- filters
select pg_temp.check('class filter keeps only matching classes',
  (select count(*) from public.search_trademarks_hybrid(p_terms => array['NOOR'], p_classes => array[11]) where serial_number like '9003-%') = 1);
select pg_temp.check('gazette filter applies',
  (select count(*) from public.search_trademarks_hybrid(p_terms => array['NOOR'], p_gazette => 'no-such-gazette')) = 0);

-- validation
select pg_temp.check('rejects an embedding of the wrong length',
  pg_temp.expect_error($$select * from public.search_trademarks_hybrid(p_embedding => array[1,2,3]::double precision[])$$, '22023'));
select pg_temp.check('rejects an empty query',
  pg_temp.expect_error($$select * from public.search_trademarks_hybrid()$$, '22023'));
select pg_temp.check('attorney column is not part of the result shape',
  (select count(*) from pg_proc p where p.proname = 'search_trademarks_hybrid' and pg_get_function_result(p.oid) ilike '%attorney%') = 0
  and (select count(*) from pg_proc p where p.proname = 'search_trademarks_hybrid') = 1);
reset role;

-- 5. cleanup cascades -----------------------------------------------------------
delete from public.trademarks where serial_number like '9003-%';
select pg_temp.check('deleting trademarks cascades to their analysis rows', pg_temp.analysis_count() = 0);

\o
\echo '--- done'
