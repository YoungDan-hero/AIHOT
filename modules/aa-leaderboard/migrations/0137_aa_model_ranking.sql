CREATE TABLE aa_model_ranking (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array'),
  updated_at timestamptz NOT NULL
);
