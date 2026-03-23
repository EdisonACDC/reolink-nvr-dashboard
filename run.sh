#!/bin/sh
set -e

PGDATA="/data/postgres"

echo "[NVR] Starting Reolink NVR Dashboard v1.1.0..."

# Decompress pre-built bundles if needed
if [ -f /app/artifacts/api-server/dist/index.mjs.gz ] && [ ! -f /app/artifacts/api-server/dist/index.mjs ]; then
    echo "[NVR] Decompressing server bundle..."
    gunzip -k /app/artifacts/api-server/dist/index.mjs.gz
fi
FRONTEND_JS=$(ls /app/artifacts/nvr-dashboard/dist/public/assets/*.js.gz 2>/dev/null | head -1)
if [ -n "$FRONTEND_JS" ] && [ ! -f "${FRONTEND_JS%.gz}" ]; then
    echo "[NVR] Decompressing frontend bundle..."
    gunzip -k "$FRONTEND_JS"
fi

# Ensure postgres user exists (apk add postgresql creates it, but double-check)
id postgres > /dev/null 2>&1 || { addgroup -S postgres; adduser -S -G postgres -H postgres; }

# Pick the user-switching tool available in this image
if command -v s6-setuidgid > /dev/null 2>&1; then
    RUNAS="s6-setuidgid postgres"
elif [ -x "/command/s6-setuidgid" ]; then
    RUNAS="/command/s6-setuidgid postgres"
elif command -v su-exec > /dev/null 2>&1; then
    RUNAS="su-exec postgres"
elif command -v gosu > /dev/null 2>&1; then
    RUNAS="gosu postgres"
else
    # busybox su — always available in Alpine
    RUNAS=""
    RUN_VIA_SU=1
fi

run_as_postgres() {
    if [ -n "${RUN_VIA_SU:-}" ]; then
        su postgres -c "$*"
    else
        $RUNAS "$@"
    fi
}

# Initialize PostgreSQL on first run
if [ ! -f "$PGDATA/PG_VERSION" ]; then
    echo "[NVR] Initializing database..."
    mkdir -p "$PGDATA"
    chown -R postgres:postgres "$PGDATA"
    run_as_postgres initdb -D "$PGDATA" -U postgres --auth-host=trust --auth-local=trust
fi

# Fix permissions and start PostgreSQL
chown -R postgres:postgres "$PGDATA"
echo "[NVR] Starting database..."
run_as_postgres pg_ctl -D "$PGDATA" -l "$PGDATA/server.log" start -w -o "-c listen_addresses=localhost"

# Create database and apply schema
run_as_postgres createdb nvrdb 2>/dev/null || true
run_as_postgres psql nvrdb -f /app/init.sql 2>/dev/null || true
echo "[NVR] Database ready."

export DATABASE_URL="postgresql://postgres@localhost/nvrdb"
export PORT=3000
export NODE_ENV=production
export ADDON_MODE=true

echo "[NVR] Starting web server on port 3000..."
exec node /app/artifacts/api-server/dist/index.mjs
