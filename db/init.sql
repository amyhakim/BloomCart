CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  source_site TEXT NOT NULL,
  source_product_id TEXT,
  source_url TEXT,
  cart_url TEXT,

  prices NUMERIC(12, 2)[],

  name TEXT NOT NULL,
  currency TEXT,
  quantity INTEGER DEFAULT 1,
  image_url TEXT,

  captured_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  last_checked_at TIMESTAMPTZ,
  price_changed_at TIMESTAMPTZ,
  check_error TEXT,
  price_check_method TEXT,

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

ALTER TABLE products ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_changed_at TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN IF NOT EXISTS check_error TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_check_method TEXT;

UPDATE products
SET image_url = NULL
WHERE image_url IS NOT NULL
  AND (
    lower(image_url) LIKE '%loading%'
    OR lower(image_url) LIKE '%spinner%'
    OR lower(image_url) LIKE '%placeholder%'
    OR lower(image_url) LIKE '%transparent%'
    OR lower(image_url) LIKE '%blank%'
    OR lower(image_url) LIKE '%grey-pixel%'
    OR lower(image_url) LIKE '%gray-pixel%'
    OR lower(image_url) LIKE '%pixel.gif%'
    OR lower(image_url) LIKE '%1x1%'
    OR lower(image_url) LIKE 'data:image%'
    OR lower(image_url) LIKE '%.gif%'
  );
