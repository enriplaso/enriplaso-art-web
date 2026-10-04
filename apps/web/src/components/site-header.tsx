import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { SITE_NAME } from '@/lib/site';
import { LocaleSwitcher } from './locale-switcher';

export function SiteHeader({ hasAboutPage }: { hasAboutPage: boolean }) {
  const t = useTranslations('Nav');

  return (
    <header className="sticky top-0 z-40 border-b border-line/60 bg-ink/75 backdrop-blur-md">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-4 focus:z-50 focus:rounded focus:bg-paper focus:px-3 focus:py-2 focus:text-ink"
      >
        {t('skipToContent')}
      </a>
      <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-6 px-5 sm:px-8">
        <Link
          href="/"
          aria-label={t('home')}
          className="font-display text-2xl leading-none tracking-tight"
        >
          {SITE_NAME}
        </Link>
        <div className="flex items-center gap-6 sm:gap-10">
          <nav aria-label={SITE_NAME}>
            <ul className="flex items-center gap-5 text-sm sm:gap-8">
              <li>
                <Link
                  href="/works"
                  className="transition-colors hover:text-accent"
                >
                  {t('works')}
                </Link>
              </li>
              {hasAboutPage && (
                <li>
                  <Link
                    href="/about"
                    className="transition-colors hover:text-accent"
                  >
                    {t('about')}
                  </Link>
                </li>
              )}
            </ul>
          </nav>
          <div className="hidden sm:block">
            <LocaleSwitcher />
          </div>
        </div>
      </div>
    </header>
  );
}
