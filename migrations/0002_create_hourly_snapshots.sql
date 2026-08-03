-- Switch from one daily 19:30-21:30 snapshot to hourly window snapshots.
-- Each day now has up to 14 rows (08:30-09:30 ... 21:30-22:30).

CREATE TABLE venue_snapshots_new (
  snapshot_date TEXT NOT NULL,
  window_begin TEXT NOT NULL,
  window_end TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  source_timestamp INTEGER,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  available_count INTEGER,
  available_courts TEXT,
  details_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (snapshot_date, window_begin)
);

-- Migrate successful legacy daily snapshots into the two 19:30 / 20:30 rows.
INSERT INTO venue_snapshots_new (
  snapshot_date,
  window_begin,
  window_end,
  captured_at,
  source_timestamp,
  status,
  available_count,
  available_courts,
  details_json,
  error_message,
  created_at,
  updated_at
)
SELECT
  v.snapshot_date,
  '19:30',
  '20:30',
  v.captured_at,
  v.source_timestamp,
  'success',
  v.first_slot_count,
  v.first_slot_courts,
  (
    SELECT json_group_array(
      json_object(
        'name', json_extract(c.value, '$.name'),
        'state', json_extract(c.value, '$.slots[0].state'),
        'isSure', json_extract(c.value, '$.slots[0].isSure'),
        'hasBookingMarker', json_extract(c.value, '$.slots[0].hasBookingMarker')
      )
    )
    FROM json_each(v.target_slots_json) AS c
  ),
  NULL,
  v.created_at,
  v.updated_at
FROM venue_snapshots AS v
WHERE v.status = 'success';

INSERT INTO venue_snapshots_new (
  snapshot_date,
  window_begin,
  window_end,
  captured_at,
  source_timestamp,
  status,
  available_count,
  available_courts,
  details_json,
  error_message,
  created_at,
  updated_at
)
SELECT
  v.snapshot_date,
  '20:30',
  '21:30',
  v.captured_at,
  v.source_timestamp,
  'success',
  v.second_slot_count,
  v.second_slot_courts,
  (
    SELECT json_group_array(
      json_object(
        'name', json_extract(c.value, '$.name'),
        'state', json_extract(c.value, '$.slots[1].state'),
        'isSure', json_extract(c.value, '$.slots[1].isSure'),
        'hasBookingMarker', json_extract(c.value, '$.slots[1].hasBookingMarker')
      )
    )
    FROM json_each(v.target_slots_json) AS c
  ),
  NULL,
  v.created_at,
  v.updated_at
FROM venue_snapshots AS v
WHERE v.status = 'success';

-- Migrate failed legacy rows to the 19:30 window as a failure record.
INSERT INTO venue_snapshots_new (
  snapshot_date,
  window_begin,
  window_end,
  captured_at,
  source_timestamp,
  status,
  available_count,
  available_courts,
  details_json,
  error_message,
  created_at,
  updated_at
)
SELECT
  v.snapshot_date,
  '19:30',
  '20:30',
  v.captured_at,
  v.source_timestamp,
  'failed',
  NULL,
  NULL,
  NULL,
  v.error_message,
  v.created_at,
  v.updated_at
FROM venue_snapshots AS v
WHERE v.status = 'failed';

-- Keep the legacy table as an archive, then promote the new hourly table.
ALTER TABLE venue_snapshots RENAME TO venue_snapshots_legacy;
ALTER TABLE venue_snapshots_new RENAME TO venue_snapshots;

CREATE INDEX IF NOT EXISTS idx_venue_snapshots_captured_at_hourly
  ON venue_snapshots (captured_at DESC);
