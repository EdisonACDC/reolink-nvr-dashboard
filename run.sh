#!/bin/sh

PGDATA="/data/postgres"
PGSOCKET="/tmp/pg_nvr"

echo "[NVR] Starting Reolink NVR Dashboard v1.1.2..."

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

# Ensure postgres user exists
id postgres > /dev/null 2>&1 || { addgroup -S postgres; adduser -S -G postgres -H postgres; }

# Pick user-switching tool
if command -v s6-setuidgid > /dev/null 2>&1; then
    SWITCH="s6-setuidgid postgres"
elif [ -x "/command/s6-setuidgid" ]; then
    SWITCH="/command/s6-setuidgid postgres"
elif command -v su-exec > /dev/null 2>&1; then
    SWITCH="su-exec postgres"
else
    SWITCH=""
fi

run_as_postgres() {
    if [ -n "$SWITCH" ]; then
        $SWITCH "$@"
    else
        su postgres -c "$*"
    fi
}

# Create socket directory
mkdir -p "$PGSOCKET"
chown postgres:postgres "$PGSOCKET"

# Initialize PostgreSQL on first run
if [ ! -f "$PGDATA/PG_VERSION" ]; then
    echo "[NVR] Initializing database..."
    mkdir -p "$PGDATA"
    chown -R postgres:postgres "$PGDATA"
    run_as_postgres initdb -D "$PGDATA" -U postgres --auth-host=trust --auth-local=trust
fi

# Remove stale PID file from previous crashes
rm -f "$PGDATA/postmaster.pid"

# Fix permissions
chown -R postgres:postgres "$PGDATA"
chmod 700 "$PGDATA"

echo "[NVR] Starting PostgreSQL..."
DB_OK=0
run_as_postgres pg_ctl -D "$PGDATA" -l "$PGDATA/server.log" start -w \
    -o "-c listen_addresses=localhost \
        -c unix_socket_directories=$PGSOCKET \
        -c shared_buffers=16MB \
        -c max_connections=20 \
        -c shared_memory_type=mmap \
        -c dynamic_shared_memory_type=mmap" && DB_OK=1

if [ "$DB_OK" = "1" ]; then
    run_as_postgres createdb -h "$PGSOCKET" nvrdb 2>/dev/null || true
    run_as_postgres psql -h "$PGSOCKET" nvrdb -f /app/init.sql 2>/dev/null || true
    echo "[NVR] Database ready."
    export DATABASE_URL="postgresql://postgres@localhost/nvrdb?host=$PGSOCKET"
else
    echo "[NVR] WARNING: PostgreSQL failed to start. Server log:"
    cat "$PGDATA/server.log" 2>/dev/null | tail -30 || echo "(no log)"
    echo "[NVR] Continuing without database — UI will load but data won't persist."
    export DATABASE_URL="postgresql://postgres@localhost/nvrdb?host=$PGSOCKET"
fi

export PORT=3000
export NODE_ENV=production
export ADDON_MODE=true

echo "[NVR] Starting web server on port 3000..."
exec node /app/artifacts/api-server/dist/index.mjs
