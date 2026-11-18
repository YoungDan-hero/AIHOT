CREATE TABLE source_suggestions (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, url)
);
