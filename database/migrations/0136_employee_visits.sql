CREATE TABLE employee_visits (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  visited_at timestamptz NOT NULL DEFAULT now(),
  path text NOT NULL,
  article_id text
);
