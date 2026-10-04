import { useTranslations } from 'next-intl';
import type { PageSummary } from '@enriplaso-art-web/api-types';
import { Link } from '@/i18n/navigation';
import { SITE_NAME } from '@/lib/site';
import { LocaleSwitcher } from './locale-switcher';

// The page links come from GET /pages, so a page the admin adds (Privacy,
// Terms, Shipping & Returns…) shows up here without a deploy.
export function SiteFooter({ pages }: { pages: PageSummary[] }) {
  const t = useTranslations('Footer');

  return (
    <footer className="mt-32 border-t border-line">
      <div className="mx-auto max-w-[1600px] px-5 pt-16 pb-10 sm:px-8">
        <p
          aria-hidden
          className="font-display text-[clamp(3.5rem,13vw,12rem)] leading-[0.85] tracking-tight text-paper/90"
        >
          {SITE_NAME}
        </p>
        <div className="mt-14 flex flex-col gap-10 border-t border-line pt-8 text-sm text-muted sm:flex-row sm:items-start sm:justify-between">
          {pages.length > 0 && (
            <nav aria-label={t('pages')}>
              <ul className="flex flex-wrap gap-x-8 gap-y-3">
                {pages.map((page) => (
                  <li key={page.id}>
                    <Link
                      href={`/${page.slug}`}
                      className="transition-colors hover:text-paper"
                    >
                      {page.title ?? page.slug}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          <LocaleSwitcher />
          <p>{t('rights', { year: new Date().getFullYear() })}</p>
        </div>
      </div>
    </footer>
  );
}
