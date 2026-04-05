CREATE TABLE IF NOT EXISTS scores (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT    NOT NULL,
  username    TEXT    NOT NULL,
  word        TEXT    NOT NULL,
  tries       INTEGER NOT NULL DEFAULT 0,
  date        TEXT    NOT NULL,
  solved_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(session_id, date)
);
CREATE INDEX IF NOT EXISTS idx_scores_date ON scores(date);
CREATE INDEX IF NOT EXISTS idx_scores_date_try ON scores(date, tries);
