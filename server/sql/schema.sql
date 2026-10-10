-- Wholesale Market database schema (PostgreSQL). Safe to run again and again: everything is IF NOT EXISTS.

-- People who log in: the admin and the customers. (Wholesalers are NOT users: the admin keeps them in the wholesalers table.)
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role          text NOT NULL CHECK (role IN ('admin', 'customer')),
  name          text NOT NULL,
  email         text NOT NULL,
  mobile        text NOT NULL,
  password_hash text NOT NULL,
  address       text NOT NULL DEFAULT '',
  pincode       text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS users_mobile_key ON users (mobile);

CREATE TABLE IF NOT EXISTS wholesalers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store      text NOT NULL,
  name       text NOT NULL,
  mobile     text NOT NULL,
  address    text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS wholesalers_store_key ON wholesalers (lower(store));

CREATE TABLE IF NOT EXISTS products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wholesaler_id uuid NOT NULL REFERENCES wholesalers (id) ON DELETE CASCADE,
  name          text NOT NULL,
  category      text NOT NULL DEFAULT 'Other',
  description   text NOT NULL DEFAULT '',
  price         numeric(12, 2) NOT NULL CHECK (price > 0),
  qty           integer NOT NULL DEFAULT 0 CHECK (qty >= 0),
  emoji         text NOT NULL DEFAULT '📦',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_wholesaler_idx ON products (wholesaler_id);

-- Product photos live in the database too (small, resized in the browser), so there is nothing else to host
CREATE TABLE IF NOT EXISTS product_images (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  position   integer NOT NULL DEFAULT 0,
  mime       text NOT NULL,
  data       bytea NOT NULL
);
CREATE INDEX IF NOT EXISTS product_images_product_idx ON product_images (product_id, position);

-- Admin rules (COD minimum, delivery PIN codes, UPI ID ...) as one JSON value per key
CREATE TABLE IF NOT EXISTS settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per order. Customer and shop details are copied in, so an order still reads right after a wholesaler is deleted.
CREATE TABLE IF NOT EXISTS orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL UNIQUE,
  group_id         uuid NOT NULL,
  customer_id      uuid REFERENCES users (id) ON DELETE SET NULL,
  customer_name    text NOT NULL,
  customer_mobile  text NOT NULL DEFAULT '',
  wholesaler_id    uuid REFERENCES wholesalers (id) ON DELETE SET NULL,
  store            text NOT NULL,
  address          text NOT NULL DEFAULT '',
  pincode          text NOT NULL DEFAULT '',
  payment          text NOT NULL CHECK (payment IN ('UPI', 'COD')),
  pay_status       text NOT NULL DEFAULT '' CHECK (pay_status IN ('', 'Unpaid', 'Submitted', 'Paid')),
  pay_ref          text,
  pay_submitted_at timestamptz,
  paid_at          timestamptz,
  status           text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled', 'Refused')),
  cancelled_by     text,
  cancelled_at     timestamptz,
  total            numeric(12, 2) NOT NULL CHECK (total >= 0),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_group_idx ON orders (group_id);

CREATE TABLE IF NOT EXISTS order_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id uuid REFERENCES products (id) ON DELETE SET NULL,
  name       text NOT NULL,
  price      numeric(12, 2) NOT NULL,
  qty        integer NOT NULL CHECK (qty > 0),
  total      numeric(12, 2) NOT NULL
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items (order_id);

CREATE TABLE IF NOT EXISTS reviews (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  rating     integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment    text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  UNIQUE (product_id, customer_id)
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  name       text NOT NULL,
  email      text NOT NULL,
  subject    text NOT NULL,
  message    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Forgot-password codes (only a hash of the code is stored)
CREATE TABLE IF NOT EXISTS password_resets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  channel    text NOT NULL CHECK (channel IN ('email', 'mobile')),
  expires_at timestamptz NOT NULL,
  tries      integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO settings (key, value) VALUES
  ('app', '{"codMin": 5000, "pincodes": [], "upiId": "test@upi", "upiName": "Wholesale Market"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Added later (safe to run on a database that already has the tables above)
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS products_wholesaler_name_key ON products (wholesaler_id, lower(name));
