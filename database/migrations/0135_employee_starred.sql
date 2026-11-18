CREATE TABLE employee_starred (
  account_key text NOT NULL,
  article_id text NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_key, article_id)
);
