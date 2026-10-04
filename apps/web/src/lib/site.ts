import type { Metadata } from 'next';
import { routing } from '@/i18n/routing';

export const SITE_NAME = 'Enrique Plaza';

// Absolute base for canonical URLs, hreflang links and Open Graph images.
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

/**
 * The painting shown large in the home page hero, by slug. Falls back to the
 * most recently added work if it's missing or unpublished. (A "featured"
 * flag set from the admin UI would replace this list later.)
 */
export const HERO_SLUG = 'caperucita';

/**
 * canonical + one hreflang link per locale for a path (without the locale
 * prefix, e.g. '/works'), so search engines treat the language versions as
 * one page instead of duplicates.
 */
export function localeAlternates(
  locale: string,
  path: string,
): Metadata['alternates'] {
  const suffix = path === '/' ? '' : path;
  return {
    canonical: `/${locale}${suffix}`,
    languages: {
      ...Object.fromEntries(
        routing.locales.map((l) => [l, `/${l}${suffix}`]),
      ),
      'x-default': `/${routing.defaultLocale}${suffix}`,
    },
  };
}
