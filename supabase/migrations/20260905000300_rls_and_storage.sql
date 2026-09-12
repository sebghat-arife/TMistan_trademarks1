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
