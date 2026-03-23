#!/bin/sh

echo "[NVR] Starting Reolink NVR Dashboard v1.1.3..."

# Decompress pre-built server bundle if needed
if [ -f /app/artifacts/api-server/dist/index.mjs.gz ] && [ ! -f /app/artifacts/api-server/dist/index.mjs ]; then
    echo "[NVR] Decompressing server bundle..."
    gunzip -k /app/artifacts/api-server/dist/index.mjs.gz
fi

# Decompress frontend JS if needed
for gz in /app/artifacts/nvr-dashboard/dist/public/assets/*.js.gz; do
    [ -f "$gz" ] || continue
    dest="${gz%.gz}"
    [ -f "$dest" ] || gunzip -k "$gz"
done
for gz in /app/artifacts/nvr-dashboard/dist/public/assets/*.css.gz; do
    [ -f "$gz" ] || continue
    dest="${gz%.gz}"
    [ -f "$dest" ] || gunzip -k "$gz"
done

# Ensure data directory exists for JSON storage
mkdir -p /data

export PORT=3000
export NODE_ENV=production
export ADDON_MODE=true
export ADDON_DB_PATH=/data/nvr-data.json

echo "[NVR] Starting web server on port ${PORT}..."
exec node /app/artifacts/api-server/dist/index.mjs
