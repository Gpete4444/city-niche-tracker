CREATE TABLE IF NOT EXISTS sites (
  domain TEXT PRIMARY KEY,
  site_id TEXT,
  candidate_id TEXT,
  business_name TEXT,
  notify_email TEXT,
  turnstile_secret TEXT
);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  page_url TEXT,
  name TEXT,
  phone TEXT,
  email TEXT,
  service TEXT,
  message TEXT
);

CREATE INDEX IF NOT EXISTS submissions_by_time ON submissions (submitted_at);
CREATE INDEX IF NOT EXISTS submissions_by_domain ON submissions (domain);

CREATE TABLE IF NOT EXISTS spam_keywords (
  keyword TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS submit_hits (
  ip TEXT NOT NULL,
  submitted_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS submit_hits_by_ip ON submit_hits (ip, submitted_at);
