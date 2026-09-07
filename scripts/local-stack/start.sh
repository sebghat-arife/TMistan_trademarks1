#!/usr/bin/env bash
# Start the local Supabase-compatible stack: PostgreSQL 17 + PostgREST + static storage.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGBIN=${PGBIN:-/usr/lib/postgresql/17/bin}
PGDATA=${PGDATA:-$HOME/.local/share/afg-pgdata}
PGPORT=54329

if [ ! -f "$PGDATA/PG_VERSION" ]; then
  "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
fi
if ! "$PGBIN/pg_isready" -h /tmp -p $PGPORT >/dev/null 2>&1; then
  "$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $PGPORT -k /tmp -c listen_addresses=127.0.0.1" -l /tmp/afg-pg.log start >/dev/null
  sleep 2
fi
PSQL="$PGBIN/psql -h /tmp -p $PGPORT -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -tc "select 1 from pg_database where datname='afg_registry'" | grep -q 1 || $PSQL -c "create database afg_registry"
$PSQL -d afg_registry -f "$ROOT/supabase/dev/00_supabase_shim.sql" 2>&1 | grep -v NOTICE || true
for f in "$ROOT"/supabase/migrations/*.sql; do $PSQL -d afg_registry -f "$f" 2>&1 | grep -v NOTICE || true; done
echo "database ready on 127.0.0.1:$PGPORT"

# Local-only dev administrator (no GoTrue on the local stack): a fixed uuid with an
# admin row in user_roles + an `authenticated` JWT for it. Paste LOCAL_ADMIN_KEY
# into the Login page when running against this stack.
LOCAL_ADMIN_UUID="00000000-0000-4000-8000-00000000ad01"
$PSQL -d afg_registry -c "insert into public.user_roles (user_id, role) values ('$LOCAL_ADMIN_UUID', 'admin') on conflict (user_id) do nothing"
if [ ! -f "$HERE/keys.env" ]; then
  { echo "LOCAL_ANON_KEY=$(python3 "$HERE/mint_jwt.py" anon)"; echo "LOCAL_SERVICE_ROLE_KEY=$(python3 "$HERE/mint_jwt.py" service_role)"; } > "$HERE/keys.env"
fi
grep -q LOCAL_ADMIN_KEY "$HERE/keys.env" || echo "LOCAL_ADMIN_KEY=$(python3 "$HERE/mint_jwt.py" authenticated $LOCAL_ADMIN_UUID)" >> "$HERE/keys.env"
echo "PostgREST:      $HOME/.local/bin/postgrest $HERE/postgrest.conf         (port 54321)"
echo "Static storage: python3 $HERE/static_storage.py $ROOT/local-storage 54322"
echo "Web:            cd $ROOT/web && npm run dev                              (port 5173)"
