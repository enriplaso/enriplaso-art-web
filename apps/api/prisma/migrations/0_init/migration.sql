-- =====================================================================
-- Art Shop — PostgreSQL Schema
-- Target: PostgreSQL 14+
-- Design notes:
--   * Products are mostly one-of-a-kind (is_unique = true, qty <= 1)
--   * Single admin account, no roles/permissions needed
--   * No customer accounts — checkout is guest-only, orders store
--     contact/shipping info directly. `customers` is optional and only
--     used to recognize repeat buyers by email.
--   * i18n: `locales` is a table, not an enum, so new languages are a
--     row insert, not a migration. Only editorial copy that actually
--     varies by language is translated (product description, category
--     name/description); product title, slugs, and everything else
--     stay single-valued. A translation missing for a locale should
--     fall back to the default locale (`locales.is_default`) at the
--     application layer — the schema doesn't enforce completeness.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive email

-- ========================= ENUMS =========================

CREATE TYPE product_status AS ENUM ('draft', 'published', 'reserved', 'sold', 'archived');
CREATE TYPE order_status   AS ENUM ('pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded');
CREATE TYPE payment_status AS ENUM ('pending', 'authorized', 'captured', 'failed', 'refunded', 'partially_refunded');
CREATE TYPE return_status  AS ENUM ('requested', 'approved', 'rejected', 'received', 'refunded');

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

-- ========================= LOCALES (i18n) =========================
-- Supported languages. A table, not an enum, so adding a language is
-- an INSERT, not a migration. Exactly one row should have
-- is_default = true — the fallback when a translation row is missing.

CREATE TABLE locales (
    code       TEXT PRIMARY KEY,   -- ISO 639-1, e.g. 'en', 'es', 'de', 'fr'
    name       TEXT NOT NULL,      -- e.g. 'English'
    is_default BOOLEAN NOT NULL DEFAULT false,
    is_active  BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- at most one default locale
CREATE UNIQUE INDEX idx_one_default_locale ON locales(is_default) WHERE is_default;

INSERT INTO locales (code, name, is_default) VALUES
    ('en', 'English', true),
    ('es', 'Spanish', false),
    ('de', 'German',  false),
    ('fr', 'French',  false);

-- ========================= CATEGORIES =========================
-- name/description are translated (see category_translations); slug
-- stays a single language-neutral URL segment.

CREATE TABLE categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT NOT NULL UNIQUE,
    parent_id   UUID REFERENCES categories(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE category_translations (
    category_id  UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    locale_code  TEXT NOT NULL REFERENCES locales(code) ON DELETE RESTRICT,
    name         TEXT NOT NULL,
    description  TEXT,
    PRIMARY KEY (category_id, locale_code)
);

CREATE INDEX idx_category_translations_locale ON category_translations(locale_code);

-- ========================= PRODUCTS =========================
-- title stays a single fixed value (an artwork's title generally isn't
-- translated); description is translated (see product_translations).

CREATE TABLE products (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku                 TEXT UNIQUE,
    slug                TEXT NOT NULL UNIQUE,
    title               TEXT NOT NULL,
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
CREATE INDEX idx_products_tags         ON products USING gin (tags);

CREATE TABLE product_translations (
    product_id   UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    locale_code  TEXT NOT NULL REFERENCES locales(code) ON DELETE RESTRICT,
    description  TEXT,
    PRIMARY KEY (product_id, locale_code)
);

CREATE INDEX idx_product_translations_locale ON product_translations(locale_code);

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

-- ========================= STATIC PAGES (CMS-lite) =========================
-- Editable, translated long-form content that isn't tied to a product or
-- category — About Me, Privacy Policy, Terms, Shipping & Returns, etc.
-- Edited from the admin panel, same pattern as product/category
-- translations, so no code change/redeploy is needed to update copy.

CREATE TABLE pages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT NOT NULL UNIQUE,   -- e.g. 'about', 'privacy-policy', 'terms', 'shipping-returns'
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE page_translations (
    page_id      UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    locale_code  TEXT NOT NULL REFERENCES locales(code) ON DELETE RESTRICT,
    title        TEXT NOT NULL,
    body         TEXT NOT NULL,   -- markdown or HTML, rendered as-is by the frontend
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (page_id, locale_code)
);

CREATE INDEX idx_page_translations_locale ON page_translations(locale_code);

-- updated_at trigger for this table is created later, alongside
-- set_updated_at() (see the updated_at TRIGGER section at the bottom).

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

-- ========================= RETURNS =========================
-- One row per returned line item (an order with multiple items gets
-- one returns row per item actually being returned). Tracks the
-- admin workflow (requested -> approved/rejected -> received ->
-- refunded) and what happens to the physical piece afterward —
-- relevant since most items are one-of-a-kind originals, not
-- restockable SKUs. EU buyers generally have a 14-day statutory
-- right of withdrawal on distance sales; this isn't just a courtesy
-- return policy.

CREATE TABLE returns (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id              UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    order_item_id         UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
    status                return_status NOT NULL DEFAULT 'requested',
    reason                TEXT,                 -- buyer-stated reason
    admin_notes           TEXT,
    product_disposition   TEXT CHECK (product_disposition IN ('pending', 'relisted', 'archived_damaged')) NOT NULL DEFAULT 'pending',
    provider_refund_id    TEXT,                 -- e.g. Stripe refund ID, once refunded
    refund_amount_cents   BIGINT,
    requested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at           TIMESTAMPTZ            -- set when status reaches 'rejected' or 'refunded'
);

CREATE INDEX idx_returns_order  ON returns(order_id);
CREATE INDEX idx_returns_status ON returns(status);

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

CREATE TRIGGER trg_page_translations_updated_at
    BEFORE UPDATE ON page_translations
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
