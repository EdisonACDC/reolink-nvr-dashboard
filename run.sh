#!/bin/bash
set -e

PGDATA="/data/postgres"

echo "[NVR] Reolink NVR Dashboard starting..."

# Create postgres user if missing (not created by apk on all base images)
if ! id postgres > /dev/null 2>&1; then
    addgroup -S postgres 2>/dev/null || true
    adduser -S -D -H -G postgres postgres 2>/dev/null || true
fi

# Initialize PostgreSQL if first run
if [ ! -f "$PGDATA/PG_VERSION" ]; then
    echo "[NVR] Initializing database..."
    mkdir -p "$PGDATA"
    chown -R postgres:postgres "$PGDATA"
    su-exec postgres initdb -D "$PGDATA" -U postgres --auth-host=trust --auth-local=trust
fi

# Fix permissions and start
chown -R postgres:postgres "$PGDATA"
echo "[NVR] Starting database..."
su-exec postgres pg_ctl -D "$PGDATA" -l "$PGDATA/server.log" start -w -o "-c listen_addresses=localhost"

# Create database
su-exec postgres createdb nvrdb 2>/dev/null || true
echo "[NVR] Database ready."

# Environment
export DATABASE_URL="postgresql://postgres@localhost/nvrdb"
export PORT=3000
export NODE_ENV=production
export ADDON_MODE=true

# Run migrations
echo "[NVR] Running database migrations..."
cd /app
pnpm --filter @workspace/db run push 2>/dev/null || \
    pnpm --filter @workspace/db run push-force 2>/dev/null || \
    echo "[NVR] Migration warning - continuing..."

echo "[NVR] Starting web server on port 3000..."
exec node --enable-source-maps /app/artifacts/api-server/dist/index.mjs
