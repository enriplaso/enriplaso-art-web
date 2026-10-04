/**
 * The JSON the API sends, as the client receives it — not the server's
 * in-memory objects. So timestamps are ISO-8601 strings (not Date), and
 * BigInt money amounts are decimal strings (JSON has no BigInt).
 *
 * Conventions (README's "API response types"):
 * - `T | null`: the field is always present; null means "no value"
 *   (e.g. a painting with no recorded year).
 * - optional `field?`: the field is left out entirely in some contexts
 *   (e.g. prices while SHOP_ENABLED is off).
 *
 * Written as a .d.ts so it's types-only: nothing to build, and importing it
 * (always with `import type`) adds nothing to either app's output.
 */

/** ISO-8601 timestamp, e.g. "2026-10-04T09:58:23.000Z". */
export type IsoDateString = string;

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

// ========================= LOCALES & SETTINGS =========================

/** GET /locales — active locales, default first. */
export interface Locale {
  code: string;
  name: string;
  isDefault: boolean;
}

/** GET /settings */
export interface Settings {
  shopEnabled: boolean;
}

// ========================= CATEGORIES =========================

/**
 * GET /categories, GET /categories/:slug, and the category write
 * endpoints. A flat list: build the tree from `parentId`. `name` and
 * `description` are resolved to the requested locale, falling back to the
 * default one.
 */
export interface Category {
  id: string;
  slug: string;
  parentId: string | null;
  name: string | null;
  description: string | null;
}

// ========================= PAGES =========================

/** GET /pages — for nav/footer links. */
export interface PageSummary {
  id: string;
  slug: string;
  title: string | null;
}

/** GET /pages/:slug */
export interface Page {
  id: string;
  slug: string;
  /**
   * The locale actually served — the default one when the requested
   * locale has no translation. Use it for the page's `lang` attribute.
   */
  localeCode: string;
  title: string;
  /** Markdown. Never render as raw HTML. */
  body: string;
  updatedAt: IsoDateString;
}

export interface AdminPageTranslation {
  localeCode: string;
  title: string;
  body: string;
  updatedAt: IsoDateString;
}

/** GET /admin/pages, GET /admin/pages/:id, and the page write endpoints. */
export interface AdminPage {
  id: string;
  slug: string;
  createdAt: IsoDateString;
  /** Every locale that has one, sorted by locale code. */
  translations: AdminPageTranslation[];
}

// ========================= PRODUCTS =========================

export type ProductStatus =
  | 'draft'
  | 'published'
  | 'reserved'
  | 'sold'
  | 'archived';

export interface ProductImage {
  id: string;
  url: string;
  /** Resolved to the requested locale, falling back to the default one. */
  altText: string | null;
  isPrimary: boolean;
}

/** Price and stock. Omitted from public responses while the shop is off. */
export interface ProductCommerce {
  /** Integer number of cents, as a string (BigInt in the database). */
  priceCents: string;
  /** ISO 4217 code, e.g. "EUR". */
  currency: string;
  quantityAvailable: number;
}

interface ProductBase {
  id: string;
  sku: string | null;
  slug: string;
  title: string;
  /** Resolved to the requested locale, falling back to the default one. */
  description: string | null;
  medium: string | null;
  style: string | null;
  yearCreated: number | null;
  widthCm: number | null;
  heightCm: number | null;
  depthCm: number | null;
  weightKg: number | null;
  isUnique: boolean;
  status: ProductStatus;
  tags: string[];
  category: { id: string; slug: string } | null;
  /** Sorted by position. */
  images: ProductImage[];
  /** The primary image, or the first by position if none is flagged. */
  primaryImageUrl: string | null;
}

/**
 * GET /products, GET /products/:slug. The commerce fields are present
 * only while SHOP_ENABLED is on.
 */
export type Product = ProductBase & Partial<ProductCommerce>;

/**
 * GET /admin/products, and what the product/image write endpoints return:
 * commerce fields always included.
 */
export type ProductWithCommerce = ProductBase & ProductCommerce;

export interface AdminProductImage extends ProductImage {
  translations: { localeCode: string; altText: string }[];
}

/**
 * GET /admin/products/:id — every locale's description and alt text, not
 * just the resolved one, so the editor can see which are missing.
 */
export interface AdminProduct extends Omit<ProductWithCommerce, 'images'> {
  translations: { localeCode: string; description: string | null }[];
  images: AdminProductImage[];
}

// ========================= AUTH =========================

export interface AdminSummary {
  id: string;
  email: string;
  fullName: string | null;
}

/**
 * POST /auth/login. When `requiresTwoFactor` is true, no session was
 * started yet: continue with POST /auth/2fa/verify.
 */
export type LoginResponse =
  | { requiresTwoFactor: true }
  | { requiresTwoFactor: false; admin: AdminSummary };

/** POST /auth/2fa/verify */
export interface VerifyTwoFactorResponse {
  admin: AdminSummary;
  usedBackupCode: boolean;
}

/** GET /auth/me */
export interface AdminProfile extends AdminSummary {
  totpEnabled: boolean;
}

/** POST /auth/2fa/setup */
export interface TotpSetupResponse {
  secret: string;
  otpauthUrl: string;
  /** A data: URL of the QR code image, ready for an <img src>. */
  qrCodeDataUrl: string;
}

/** POST /auth/2fa/confirm — the plaintext codes, shown exactly once. */
export interface TotpConfirmResponse {
  backupCodes: string[];
}

/** POST /auth/logout, POST /auth/2fa/disable */
export interface SuccessResponse {
  success: true;
}
