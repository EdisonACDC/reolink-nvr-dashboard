#!/bin/bash
set -e

PGDATA="/data/postgres"

echo "=== Reolink NVR Dashboard Add-on ==="

# Ensure postgres user exists
if ! id postgres > /dev/null 2>&1; then
    adduser -D -H -s /sbin/nologin postgres 2>/dev/null || true
fi

# Initialize PostgreSQL data directory if needed
if [ ! -f "$PGDATA/PG_VERSION" ]; then
    echo "Initializing database..."
    mkdir -p "$PGDATA"
    chown -R postgres:postgres "$PGDATA"
    su-exec postgres initdb -D "$PGDATA" -U postgres --auth-host=trust --auth-local=trust
fi

# Fix permissions
chown -R postgres:postgres "$PGDATA"

# Start PostgreSQL
echo "Starting database..."
su-exec postgres pg_ctl -D "$PGDATA" -l "$PGDATA/logfile" start -w -o "-c listen_addresses=localhost -c port=5432"

# Wait for PostgreSQL to be ready
sleep 2

# Create application database
su-exec postgres createdb nvrdb 2>/dev/null || true

echo "Database ready."

# Export environment
export DATABASE_URL="postgresql://postgres@localhost:5432/nvrdb"
export PORT=3000
export NODE_ENV=production
export ADDON_MODE=true

# Run database migrations
echo "Running database migrations..."
cd /app
pnpm --filter @workspace/db run push 2>/dev/null || \
    pnpm --filter @workspace/db run push-force 2>/dev/null || \
    echo "Migration warning: continuing anyway..."

echo "Starting NVR Dashboard on port 3000..."
exec node --enable-source-maps /app/artifacts/api-server/dist/index.mjs
