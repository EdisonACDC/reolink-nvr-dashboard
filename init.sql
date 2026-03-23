CREATE TABLE IF NOT EXISTS nvr_config (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'My NVR',
  host TEXT NOT NULL DEFAULT '',
  port INTEGER NOT NULL DEFAULT 80,
  username TEXT NOT NULL DEFAULT 'admin',
  password TEXT NOT NULL DEFAULT '',
  rtsp_port INTEGER NOT NULL DEFAULT 554,
  http_port INTEGER NOT NULL DEFAULT 80,
  channel_count INTEGER NOT NULL DEFAULT 4,
  configured BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cameras (
  id SERIAL PRIMARY KEY,
  nvr_id INTEGER NOT NULL DEFAULT 1,
  channel INTEGER NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown',
  recording_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  motion_detection BOOLEAN NOT NULL DEFAULT TRUE,
  resolution TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recordings (
  id SERIAL PRIMARY KEY,
  camera_id INTEGER NOT NULL,
  camera_name TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  duration INTEGER NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'continuous',
  playback_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO nvr_config (name, host, port, username, password, rtsp_port, http_port, channel_count, configured)
SELECT 'My NVR', '', 80, 'admin', '', 554, 80, 4, FALSE
WHERE NOT EXISTS (SELECT 1 FROM nvr_config);
