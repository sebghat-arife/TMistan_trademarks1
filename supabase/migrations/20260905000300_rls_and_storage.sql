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
  public.gazette_sort_key(text)
  to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage buckets (skipped automatically when storage schema is absent,
-- e.g. on the local PostgREST-only dev stack)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then

    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('trademark-images', 'trademark-images', true, 10485760,
            array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/tiff'])
    on conflict (id) do update set public = excluded.public;

    insert into storage.buckets (id, name, public, file_size_limit)
    values ('source-documents', 'source-documents', false, 104857600)
    on conflict (id) do nothing;

    -- Public read of published logos
    drop policy if exists "public read trademark images" on storage.objects;
    create policy "public read trademark images"
      on storage.objects for select
      to anon, authenticated
      using (bucket_id = 'trademark-images');

    -- Admins may upload/replace images from the admin UI (importer uses service role)
    drop policy if exists "admin write trademark images" on storage.objects;
    create policy "admin write trademark images"
      on storage.objects for insert
      to authenticated
      with check (bucket_id = 'trademark-images' and public.is_admin());

    drop policy if exists "admin update trademark images" on storage.objects;
    create policy "admin update trademark images"
      on storage.objects for update
      to authenticated
      using (bucket_id = 'trademark-images' and public.is_admin());

    -- Source documents: admin only
    drop policy if exists "admin read source documents" on storage.objects;
    create policy "admin read source documents"
      on storage.objects for select
      to authenticated
      using (bucket_id = 'source-documents' and public.is_admin());

    drop policy if exists "admin write source documents" on storage.objects;
    create policy "admin write source documents"
      on storage.objects for insert
      to authenticated
      with check (bucket_id = 'source-documents' and public.is_admin());
  else
    raise notice 'storage schema not present — skipping bucket/policy setup (local dev stack)';
  end if;
end $$;
