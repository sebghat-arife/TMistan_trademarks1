-- ============================================================================
-- TMistan — APPLY MIGRATION 0800 (Contact & Feedback form + admin Inquiries inbox)
--
-- Paste this whole file into the Supabase SQL Editor and click RUN once.
-- Generated from supabase/migrations/20261013000800_contact_requests.sql by
-- scripts/build_apply_all.py — do not edit by hand, edit the migration.
--
-- Prerequisites: 0400 (admin_assert) and 0600 (admin_record_action) are in
-- place. 0700 is NOT required.
--
-- Safe by construction — ADDITIVE ONLY:
--   • adds ONE new private table public.contact_requests (RLS on, no
--     policies, no grants — nobody can read it through the API)
--   • adds the public function submit_contact_request() (server-side
--     validation, rate limiting, honeypot) and contact_form_status()
--   • adds admin-only functions admin_contact_counts / admin_list_contact_requests /
--     admin_get_contact_request / admin_update_contact_request (admin_assert)
--   • touches no existing table, column, index, policy, storage object or data row
--   • idempotent — running it twice is harmless
--
-- Afterwards: /contact actually accepts submissions (until then it shows
-- "The inquiry form is not available yet") and Admin → Inquiries lists them.
-- ============================================================================
begin;

-- ############################################################################
-- 20261013000800_contact_requests.sql
-- ############################################################################
-- ============================================================================
-- 0800 — Contact & Feedback inquiries
-- ----------------------------------------------------------------------------
-- What it does
--   • ADDs one private table, public.contact_requests, that stores the
--     inquiries sent from the public Contact & Feedback page (/contact).
--   • ADDs submit_contact_request(): the ONLY way the public site can write
--     an inquiry. It validates every field on the server (lengths, e-mail
--     syntax, inquiry type, whitelisted extra fields), discards honeypot
--     submissions, and rate-limits by e-mail address, by caller IP (stored
--     only as a salted SHA-256 hash) and globally.
--   • ADDs contact_form_status(): cheap probe the page uses to know whether
--     this migration is applied (otherwise it shows "form not available").
--   • ADDs admin_list_contact_requests / admin_get_contact_request /
--     admin_update_contact_request / admin_contact_counts for the Admin
--     Center "Inquiries" page. All start with admin_assert() (0400) and
--     status changes are written to admin_actions (0600).
--
-- Privacy / security model
--   • Row Level Security is enabled and NO policy exists for anon or
--     authenticated, and all table privileges are revoked from them: nobody
--     can read, list, change or delete inquiries through the public API —
--     not even the person who submitted one. Only the SECURITY DEFINER
--     functions above (and the service role) touch the table.
--   • No e-mail credentials or secrets are involved. Forwarding inquiries by
--     e-mail is a separate, optional step (see docs/CONTACT.md).
--
-- What it does NOT do
--   • Touches no existing table, column, policy, function or row.
--
-- Prerequisites: 0400 (admin_assert) and 0600 (admin_record_action).
-- Idempotent — safe to re-run.
-- ============================================================================

-- No extension needed: gen_random_uuid() and sha256() are built into PostgreSQL 13+ / 11+.

create table if not exists public.contact_requests (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  inquiry_type   text not null check (inquiry_type in ('general', 'trademark-research', 'data-correction', 'technical-support')),
  full_name      text not null check (length(full_name) between 2 and 120),
  email          text not null check (length(email) between 5 and 254),
  organization   text check (organization is null or length(organization) <= 200),
  subject        text not null check (length(subject) between 3 and 200),
  message        text not null check (length(message) between 10 and 5000),
  details        jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  locale         text check (locale is null or length(locale) <= 12),
  page_url       text check (page_url is null or length(page_url) <= 500),
  user_agent     text check (user_agent is null or length(user_agent) <= 300),
  ip_hash        text check (ip_hash is null or length(ip_hash) = 64),
  status         text not null default 'new' check (status in ('new', 'in_progress', 'closed', 'spam')),
  admin_note     text check (admin_note is null or length(admin_note) <= 4000),
  handled_by     uuid,
  handled_at     timestamptz
);
comment on table public.contact_requests is
  'Inquiries from the public Contact & Feedback page. Private: written only through submit_contact_request(), read only by administrators (admin_* functions).';

create index if not exists contact_requests_created_idx on public.contact_requests (created_at desc);
create index if not exists contact_requests_status_idx  on public.contact_requests (status, created_at desc);
create index if not exists contact_requests_email_idx   on public.contact_requests (lower(email), created_at desc);
create index if not exists contact_requests_ip_idx      on public.contact_requests (ip_hash, created_at desc) where ip_hash is not null;

alter table public.contact_requests enable row level security;
-- No policies on purpose: with RLS on and no policy, anon/authenticated can do nothing even if a
-- grant slipped through. Belt and braces: revoke every table privilege as well.
revoke all on table public.contact_requests from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Public probe: "is the contact form backed by this database?"
-- ----------------------------------------------------------------------------
create or replace function public.contact_form_status()
returns jsonb
language sql stable
set search_path = public as $$
  select jsonb_build_object('available', true, 'max_message_length', 5000, 'version', 1);
$$;
revoke all on function public.contact_form_status() from public;
grant execute on function public.contact_form_status() to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Public write path
-- ----------------------------------------------------------------------------
create or replace function public.submit_contact_request(
  p_inquiry_type text,
  p_full_name    text,
  p_email        text,
  p_subject      text,
  p_message      text,
  p_organization text  default null,
  p_details      jsonb default '{}'::jsonb,
  p_locale       text  default null,
  p_page_url     text  default null,
  p_honeypot     text  default null
)
returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  v_headers  jsonb;
  v_ip       text;
  v_ip_hash  text;
  v_ua       text;
  v_details  jsonb;
  v_name     text := btrim(coalesce(p_full_name, ''));
  v_email    text := btrim(coalesce(p_email, ''));
  v_subject  text := btrim(coalesce(p_subject, ''));
  v_message  text := btrim(coalesce(p_message, ''));
  v_org      text := nullif(btrim(coalesce(p_organization, '')), '');
  v_count    int;
  v_id       uuid;
  v_now      timestamptz := now();
begin
  -- Honeypot: real visitors never see this field; bots fill it. Pretend success, store nothing.
  if nullif(btrim(coalesce(p_honeypot, '')), '') is not null then
    return jsonb_build_object('id', gen_random_uuid(), 'received_at', v_now);
  end if;

  -- Server-side validation (the browser validates too, but is not trusted)
  if p_inquiry_type is null or p_inquiry_type not in ('general', 'trademark-research', 'data-correction', 'technical-support') then
    raise exception 'Please choose a valid inquiry type.' using errcode = '22023';
  end if;
  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'Please enter your full name (2–120 characters).' using errcode = '22023';
  end if;
  if length(v_email) < 5 or length(v_email) > 254 or v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' then
    raise exception 'Please enter a valid e-mail address.' using errcode = '22023';
  end if;
  if length(v_subject) < 3 or length(v_subject) > 200 then
    raise exception 'Please enter a subject (3–200 characters).' using errcode = '22023';
  end if;
  if length(v_message) < 10 or length(v_message) > 5000 then
    raise exception 'Please describe your request (10–5000 characters).' using errcode = '22023';
  end if;
  if v_org is not null and length(v_org) > 200 then
    raise exception 'Organization is too long (max 200 characters).' using errcode = '22023';
  end if;
  if p_details is not null and jsonb_typeof(p_details) <> 'object' then
    raise exception 'Invalid request details.' using errcode = '22023';
  end if;

  -- Keep only the known category-specific fields, each clipped to 1000 characters.
  select coalesce(jsonb_object_agg(d.key, left(d.value, 1000)), '{}'::jsonb)
    into v_details
    from jsonb_each_text(coalesce(p_details, '{}'::jsonb)) d
   where d.key in ('trademark_name', 'serial_number', 'applicant_name', 'trademark_class', 'gazette_number',
                   'source_page', 'research_type', 'response_format', 'purpose', 'deadline',
                   'issue_category', 'issue_url', 'browser_info')
     and nullif(btrim(d.value), '') is not null;
  if pg_column_size(v_details) > 12000 then
    raise exception 'Request details are too large.' using errcode = '22023';
  end if;

  -- Request metadata exposed by PostgREST (absent when called from psql)
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;
  v_ip := nullif(btrim(coalesce(
            v_headers ->> 'cf-connecting-ip',
            split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1),
            v_headers ->> 'x-real-ip', '')), '');
  v_ua := left(v_headers ->> 'user-agent', 300);
  -- The address itself is never stored: only a salted hash used for rate limiting.
  if v_ip is not null then
    v_ip_hash := encode(sha256(convert_to('tmistan-contact:' || v_ip, 'UTF8')), 'hex');
  end if;

  -- Rate limits (server-side, cannot be bypassed by the browser)
  select count(*) into v_count from public.contact_requests
   where lower(email) = lower(v_email) and created_at > v_now - interval '1 hour';
  if v_count >= 5 then
    raise exception 'Too many requests from this e-mail address in the last hour. Please try again later.' using errcode = 'TM429';
  end if;
  if v_ip_hash is not null then
    select count(*) into v_count from public.contact_requests
     where ip_hash = v_ip_hash and created_at > v_now - interval '1 hour';
    if v_count >= 10 then
      raise exception 'Too many requests from this connection in the last hour. Please try again later.' using errcode = 'TM429';
    end if;
  end if;
  select count(*) into v_count from public.contact_requests where created_at > v_now - interval '10 minutes';
  if v_count >= 60 then
    raise exception 'The contact form is receiving unusually many requests. Please try again in a few minutes.' using errcode = 'TM429';
  end if;

  insert into public.contact_requests
      (inquiry_type, full_name, email, organization, subject, message, details, locale, page_url, user_agent, ip_hash)
  values
      (p_inquiry_type, v_name, v_email, v_org, v_subject, v_message, v_details,
       left(nullif(btrim(coalesce(p_locale, '')), ''), 12), left(nullif(btrim(coalesce(p_page_url, '')), ''), 500), v_ua, v_ip_hash)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'received_at', v_now);
end $$;
revoke all on function public.submit_contact_request(text, text, text, text, text, text, jsonb, text, text, text) from public;
grant execute on function public.submit_contact_request(text, text, text, text, text, text, jsonb, text, text, text) to anon, authenticated;
comment on function public.submit_contact_request(text, text, text, text, text, text, jsonb, text, text, text) is
  'Public Contact & Feedback form. Validates, rate-limits (e-mail / hashed IP / global) and stores the inquiry; never returns other people''s data.';

-- ----------------------------------------------------------------------------
-- Administrator read / triage path (Admin Center → Inquiries)
-- ----------------------------------------------------------------------------
create or replace function public.admin_contact_counts()
returns jsonb
language plpgsql stable security definer
set search_path = public as $$
begin
  perform public.admin_assert();
  return (
    select jsonb_build_object(
      'total',       count(*),
      'new',         count(*) filter (where status = 'new'),
      'in_progress', count(*) filter (where status = 'in_progress'),
      'closed',      count(*) filter (where status = 'closed'),
      'spam',        count(*) filter (where status = 'spam'),
      'last_24h',    count(*) filter (where created_at > now() - interval '24 hours'))
    from public.contact_requests);
end $$;
revoke all on function public.admin_contact_counts() from public, anon;
grant execute on function public.admin_contact_counts() to authenticated;

create or replace function public.admin_list_contact_requests(
  p_status text default null,
  p_type   text default null,
  p_query  text default null,
  p_limit  int  default 50,
  p_offset int  default 0
)
returns table (
  id uuid, created_at timestamptz, inquiry_type text, full_name text, email text, organization text,
  subject text, message text, details jsonb, locale text, page_url text, status text, admin_note text,
  handled_by uuid, handled_at timestamptz, total_count bigint
)
language plpgsql stable security definer
set search_path = public as $$
declare
  v_limit  int  := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int  := greatest(coalesce(p_offset, 0), 0);
  v_q      text := nullif(btrim(coalesce(p_query, '')), '');
begin
  perform public.admin_assert();
  return query
  select c.id, c.created_at, c.inquiry_type, c.full_name, c.email, c.organization,
         c.subject, c.message, c.details, c.locale, c.page_url, c.status, c.admin_note,
         c.handled_by, c.handled_at, count(*) over () as total_count
    from public.contact_requests c
   where (p_status is null or p_status = '' or c.status = p_status)
     and (p_type   is null or p_type   = '' or c.inquiry_type = p_type)
     and (v_q is null
          or c.full_name ilike '%' || v_q || '%'
          or c.email     ilike '%' || v_q || '%'
          or c.subject   ilike '%' || v_q || '%'
          or c.message   ilike '%' || v_q || '%'
          or c.id::text  ilike v_q || '%'
          or coalesce(c.details ->> 'serial_number', '') ilike '%' || v_q || '%')
   order by c.created_at desc
   limit v_limit offset v_offset;
end $$;
revoke all on function public.admin_list_contact_requests(text, text, text, int, int) from public, anon;
grant execute on function public.admin_list_contact_requests(text, text, text, int, int) to authenticated;

create or replace function public.admin_get_contact_request(p_id uuid)
returns public.contact_requests
language plpgsql stable security definer
set search_path = public as $$
declare v_row public.contact_requests;
begin
  perform public.admin_assert();
  select * into v_row from public.contact_requests where id = p_id;
  return v_row;
end $$;
revoke all on function public.admin_get_contact_request(uuid) from public, anon;
grant execute on function public.admin_get_contact_request(uuid) to authenticated;

create or replace function public.admin_update_contact_request(p_id uuid, p_status text, p_admin_note text default null)
returns public.contact_requests
language plpgsql security definer
set search_path = public as $$
declare v_row public.contact_requests;
begin
  perform public.admin_assert();
  if p_status is null or p_status not in ('new', 'in_progress', 'closed', 'spam') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  update public.contact_requests
     set status     = p_status,
         admin_note = left(nullif(btrim(coalesce(p_admin_note, '')), ''), 4000),
         handled_by = auth.uid(),
         handled_at = now()
   where id = p_id
   returning * into v_row;
  if v_row.id is null then
    raise exception 'Inquiry not found' using errcode = 'P0002';
  end if;
  perform public.admin_record_action('contact.update', 'contact_request', array[p_id::text], '{}', '{}', null, 1, 'success',
                                     jsonb_build_object('status', p_status, 'has_note', p_admin_note is not null));
  return v_row;
end $$;
revoke all on function public.admin_update_contact_request(uuid, text, text) from public, anon;
grant execute on function public.admin_update_contact_request(uuid, text, text) to authenticated;

-- PostgREST: pick up the new table/functions immediately
notify pgrst, 'reload schema';

commit;

-- post-checks -------------------------------------------------------------
select 'contact_requests table' as object,
       (select count(*)::text from pg_tables where schemaname = 'public' and tablename = 'contact_requests') as value
union all select 'RLS enabled',
       (select relrowsecurity::text from pg_class where oid = 'public.contact_requests'::regclass)
union all select 'anon/authenticated table grants (must be 0)',
       (select count(*)::text from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'contact_requests' and grantee in ('anon', 'authenticated'))
union all select 'anon may call submit_contact_request',
       (select count(*)::text from information_schema.routine_privileges
         where specific_schema = 'public' and routine_name = 'submit_contact_request' and grantee = 'anon' and privilege_type = 'EXECUTE')
union all select 'contact functions',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('contact_form_status','submit_contact_request','admin_contact_counts','admin_list_contact_requests','admin_get_contact_request','admin_update_contact_request'))
union all select 'trademarks (unchanged)', count(*)::text from public.trademarks;
