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
