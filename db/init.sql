CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  source_site TEXT NOT NULL,
  source_product_id TEXT,
  source_url TEXT,
  cart_url TEXT,

  name TEXT NOT NULL,
  price NUMERIC(12, 2),
  currency TEXT,
  quantity INTEGER DEFAULT 1,
  image_url TEXT,

  captured_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  lowest_price NUMERIC(12, 2),
  rating TEXT,
  verdict TEXT,
  badge TEXT,
  shelf TEXT DEFAULT 'Recently Added',

  raw_product JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS products_source_identity_idx
ON products (source_site, source_product_id)
WHERE source_product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS products_last_seen_idx ON products (last_seen_at DESC);
