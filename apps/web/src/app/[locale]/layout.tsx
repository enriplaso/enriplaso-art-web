import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter, Instrument_Serif } from 'next/font/google';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { PageSummary } from '@enriplaso-art-web/api-types';
import { routing } from '@/i18n/routing';
import { getPages } from '@/lib/api';
import { localeAlternates, SITE_NAME, SITE_URL } from '@/lib/site';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import '../globals.css';

// next/font downloads these at build time and serves them from this site,
// so visitors' browsers never contact Google (no IP sent to a third party;
// see the README's note on Google Fonts and GDPR).
const display = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-instrument-serif',
});
const sans = Inter({ subsets: ['latin'], variable: '--font-inter' });

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Metadata' });
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: t('title'), template: `%s — ${SITE_NAME}` },
    description: t('description'),
    alternates: localeAlternates(locale, '/'),
    openGraph: { siteName: SITE_NAME, locale, type: 'website' },
  };
}

// Header and footer links shouldn't take the whole site down if the API is
// briefly unreachable: the page itself will show the error if it needs data.
async function loadPages(locale: string): Promise<PageSummary[]> {
  try {
    return await getPages(locale);
  } catch (error) {
    console.error('Could not load static pages for navigation', error);
    return [];
  }
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const pages = await loadPages(locale);

  return (
    <html lang={locale} className={`${display.variable} ${sans.variable}`}>
      <body className="flex min-h-svh flex-col">
        <NextIntlClientProvider>
          <SiteHeader hasAboutPage={pages.some((p) => p.slug === 'about')} />
          <main id="content" className="flex-1">
            {children}
          </main>
          <SiteFooter pages={pages} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
