-- Single-row alert configuration for the "remind me when fewer than X courts are free"
-- feature. The user enables it manually each day; the worker auto-disables it after 18:00.

CREATE TABLE IF NOT EXISTS alert_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  threshold INTEGER,
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO alert_config (id, threshold, enabled, updated_at)
VALUES (1, 3, 0, datetime('now'));
