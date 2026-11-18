CREATE INDEX CONCURRENTLY IF NOT EXISTS employee_visits_time_idx ON employee_visits (visited_at DESC, id DESC);
