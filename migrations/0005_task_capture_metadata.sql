ALTER TABLE tasks ADD COLUMN capture_fingerprint TEXT;
ALTER TABLE tasks ADD COLUMN estimated_duration_label TEXT
  CHECK (estimated_duration_label IS NULL OR estimated_duration_label IN ('5m','15m','30m','1h','2h+','Project'));
