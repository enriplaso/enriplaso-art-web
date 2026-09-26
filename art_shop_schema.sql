-- =====================================================================
-- Art Shop — PostgreSQL Schema
-- Target: PostgreSQL 14+
-- Design notes:
--   * Products are mostly one-of-a-kind (is_unique = true, qty <= 1)
--   * Single admin account, no roles/permissions needed
--   * No customer accounts — checkout is guest-only, orders store
--     contact/shipping info directly. `customers` is optional and only
--     used to recognize repeat buyers by email.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- fuzzy search on title/artist
CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive email

-- ========================= ENUMS =========================

CREATE TYPE product_status AS ENUM ('draft', 'published', 'reserved', 'sold', 'archived');
CREATE TYPE order_status   AS ENUM ('pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded');
CREATE TYPE payment_status AS ENUM ('pending', 'authorized', 'captured', 'failed', 'refunded', 'partially_refunded');

-- ========================= ADMIN =========================
-- Only ever one row in practice, but modeled as a table so you can
-- rotate credentials / add a second admin later without a migration.

CREATE TABLE admins (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         CITEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name     TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ
);

-- ========================= CATEGORIES =========================

CREATE TABLE categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL UNIQUE,
    parent_id   UUID REFERENCES categories(id) ON DELETE SET NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========================= PRODUCTS =========================

CREATE TABLE products (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku                 TEXT UNIQUE,
    slug                TEXT NOT NULL UNIQUE,
    title               TEXT NOT NULL,
    description         TEXT,
    artist_name         TEXT,
    medium              TEXT,               -- e.g. "Oil on canvas"
    style               TEXT,               -- e.g. "Abstract", "Impressionist"
    year_created        INT,
    width_cm            NUMERIC(8,2),
    height_cm           NUMERIC(8,2),
    depth_cm            NUMERIC(8,2),
    weight_kg           NUMERIC(8,2),
    price_cents         BIGINT NOT NULL CHECK (price_cents >= 0),
    currency            CHAR(3) NOT NULL DEFAULT 'EUR',
    category_id         UUID REFERENCES categories(id) ON DELETE SET NULL,
    tags                TEXT[] NOT NULL DEFAULT '{}',
    is_unique           BOOLEAN NOT NULL DEFAULT true,   -- one-of-a-kind original vs. edition/print
    quantity_available  INT NOT NULL DEFAULT 1 CHECK (quantity_available >= 0),
    status              product_status NOT NULL DEFAULT 'draft',
    reserved_until       TIMESTAMPTZ,        -- soft-lock while a buyer is mid-checkout
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_items_capped_at_one CHECK (NOT is_unique OR quantity_available <= 1)
);

CREATE INDEX idx_products_status       ON products(status);
CREATE INDEX idx_products_category     ON products(category_id);
CREATE INDEX idx_products_title_trgm   ON products USING gin (title gin_trgm_ops);
CREATE INDEX idx_products_artist_trgm  ON products USING gin (artist_name gin_trgm_ops);
CREATE INDEX idx_products_tags         ON products USING gin (tags);

-- ========================= PRODUCT IMAGES =========================

CREATE TABLE product_images (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    url         TEXT NOT NULL,
    alt_text    TEXT,
    position    INT NOT NULL DEFAULT 0,
    is_primary  BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- only one primary image per product
CREATE UNIQUE INDEX idx_one_primary_image_per_product
    ON product_images(product_id) WHERE is_primary;

CREATE INDEX idx_product_images_product ON product_images(product_id);

-- ========================= CUSTOMERS (optional) =========================
-- No password, no login. Just lets you group orders by email if the
-- same buyer returns. Safe to leave unused if you don't need it.

CREATE TABLE customers (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email      CITEXT NOT NULL UNIQUE,
    full_name  TEXT,
    phone      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========================= ORDERS =========================

CREATE TABLE orders (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number     TEXT NOT NULL UNIQUE,        -- human-readable, e.g. AS-2026-000123
    customer_id      UUID REFERENCES customers(id) ON DELETE SET NULL,  -- nullable, guest checkout
    email            CITEXT NOT NULL,
    full_name        TEXT NOT NULL,
    phone            TEXT,
    shipping_address JSONB NOT NULL,
    billing_address  JSONB,
    status           order_status NOT NULL DEFAULT 'pending',
    subtotal_cents   BIGINT NOT NULL DEFAULT 0,
    shipping_cents   BIGINT NOT NULL DEFAULT 0,
    tax_cents        BIGINT NOT NULL DEFAULT 0,
    total_cents      BIGINT NOT NULL DEFAULT 0,
    currency         CHAR(3) NOT NULL DEFAULT 'EUR',
    customer_notes   TEXT,
    admin_notes      TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_email  ON orders(email);
CREATE INDEX idx_orders_status ON orders(status);

-- ========================= ORDER ITEMS =========================
-- Snapshots title/price so editing or deleting a product later
-- never changes what a past order shows.

CREATE TABLE order_items (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id              UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id            UUID REFERENCES products(id) ON DELETE SET NULL,
    title_snapshot        TEXT NOT NULL,
    price_cents_snapshot  BIGINT NOT NULL,
    quantity              INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
    subtotal_cents        BIGINT NOT NULL
);

CREATE INDEX idx_order_items_order   ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);

-- ========================= PAYMENTS =========================

CREATE TABLE payments (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id                 UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    provider                 TEXT NOT NULL,        -- 'stripe', 'paypal', ...
    provider_transaction_id  TEXT,
    amount_cents             BIGINT NOT NULL,
    currency                 CHAR(3) NOT NULL,
    status                   payment_status NOT NULL DEFAULT 'pending',
    raw_response             JSONB,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_order ON payments(order_id);

-- ========================= CART (guest, session-based) =========================
-- session_id is a UUID stored in a browser cookie — no account needed.

CREATE TABLE cart_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID NOT NULL,
    product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity    INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (session_id, product_id)
);

CREATE INDEX idx_cart_session ON cart_items(session_id);

-- ========================= CONSENT LOGS (GDPR) =========================
-- An append-only log, not a single flag: regulators expect proof of
-- *when, how, and to what* someone consented, and each withdrawal is
-- logged too rather than overwriting the earlier record. Covers both
-- anonymous visitors (session_id, e.g. a cookie-banner choice) and
-- known customers (customer_id / email, e.g. a newsletter opt-in).

CREATE TABLE consent_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID,                         -- anonymous visitor, from cookie
    customer_id     UUID REFERENCES customers(id) ON DELETE SET NULL,
    email           CITEXT,                       -- captured even without a customers row
    consent_type    TEXT NOT NULL,                -- 'analytics_cookies', 'marketing_cookies', 'newsletter', ...
    action          TEXT NOT NULL CHECK (action IN ('given', 'withdrawn')),
    method          TEXT,                         -- 'cookie_banner', 'checkout_checkbox', 'unsubscribe_link', ...
    policy_version  TEXT,                         -- version of the privacy policy / cookie notice shown
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (session_id IS NOT NULL OR customer_id IS NOT NULL OR email IS NOT NULL)
);

CREATE INDEX idx_consent_logs_session  ON consent_logs(session_id);
CREATE INDEX idx_consent_logs_customer ON consent_logs(customer_id);
CREATE INDEX idx_consent_logs_email    ON consent_logs(email);
CREATE INDEX idx_consent_logs_type     ON consent_logs(consent_type);

-- Current consent state per subject/type = the most recent row for
-- that (session_id/customer_id/email, consent_type) pair, e.g.:
--   SELECT DISTINCT ON (email, consent_type) *
--   FROM consent_logs WHERE email = 'someone@example.com'
--   ORDER BY email, consent_type, created_at DESC;

-- ========================= updated_at TRIGGER =========================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- Typical flow for a unique-item sale:
--   1. Buyer adds product to cart_items (session_id from cookie).
--   2. At checkout start: set product.status='reserved',
--      reserved_until = now() + interval '15 minutes'.
--   3. On payment success: create order + order_items + payment,
--      set product.status='sold', quantity_available=0.
--   4. A scheduled job releases products back to 'published' if
--      reserved_until has passed without a completed payment.
-- =====================================================================
