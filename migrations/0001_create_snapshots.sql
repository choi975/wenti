CREATE TABLE IF NOT EXISTS venue_snapshots (
  snapshot_date TEXT PRIMARY KEY,
  captured_at TEXT NOT NULL,
  source_timestamp INTEGER,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  continuous_count INTEGER,
  continuous_courts TEXT,
  first_slot_count INTEGER,
  first_slot_courts TEXT,
  second_slot_count INTEGER,
  second_slot_courts TEXT,
  target_slots_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_venue_snapshots_captured_at
  ON venue_snapshots (captured_at DESC);
