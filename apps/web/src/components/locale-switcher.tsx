'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';

// Same page, other language: usePathname() returns the path without the
// locale prefix, and Link adds the target one.
export function LocaleSwitcher() {
  const current = useLocale();
  const pathname = usePathname();
  const t = useTranslations('Nav');

  return (
    <nav aria-label={t('language')}>
      <ul className="flex items-center gap-3 text-xs tracking-[0.14em] uppercase">
        {routing.locales.map((locale) => (
          <li key={locale}>
            <Link
              href={pathname}
              locale={locale}
              hrefLang={locale}
              aria-current={locale === current ? 'true' : undefined}
              className={
                locale === current
                  ? 'text-paper'
                  : 'text-muted transition-colors hover:text-paper'
              }
            >
              {locale}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
