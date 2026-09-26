import { defineRouting } from 'next-intl/routing';

// Mirrors the `locales` table in art_shop_schema.sql (en is is_default = true).
export const routing = defineRouting({
  locales: ['en', 'es', 'de', 'fr'],
  defaultLocale: 'en',
});
