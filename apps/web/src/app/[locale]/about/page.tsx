import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import Markdown from 'react-markdown';
import { getPage } from '@/lib/api';
import { INSTAGRAM_URL, localeAlternates, SITE_NAME } from '@/lib/site';
// A static import: part of the page's design, deployed with the site rather
// than uploaded through the API. Next.js reads its dimensions and makes a
// tiny blurred preview at build time (README's "Static images").
import portrait from '@/assets/enrique-plaza.jpg';

// The About page: the artist's portrait beside the text. The text is the
// admin-edited `about` page from the API (translated, Markdown), like any
// other static page; only the layout and the photo are specific to it.
// This fixed route takes precedence over the generic /[slug] one.

const SLUG = 'about';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const page = await getPage(SLUG, locale);
  if (!page) return {};
  return {
    title: page.title,
    alternates: localeAlternates(locale, `/${SLUG}`),
    openGraph: { images: [{ url: portrait.src }] },
  };
}

export default async function AboutPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const page = await getPage(SLUG, locale);
  if (!page) notFound();
  const t = await getTranslations('About');

  return (
    <article className="mx-auto grid max-w-[1600px] gap-12 px-5 pt-12 sm:px-8 sm:pt-16 lg:grid-cols-12 lg:gap-20">
      <figure className="lg:col-span-5">
        <div className="lg:sticky lg:top-28">
          <Image
            src={portrait}
            alt={t('portraitAlt')}
            placeholder="blur"
            priority
            sizes="(min-width: 1024px) 40vw, 100vw"
            className="h-auto w-full"
          />
          <figcaption className="mt-4 flex items-baseline justify-between gap-4 text-sm text-muted">
            <span className="font-display text-xl text-paper">{SITE_NAME}</span>
            <span className="tracking-[0.2em] uppercase">Enriplaso</span>
          </figcaption>
        </div>
      </figure>

      {/* `lang` is the locale actually served: it differs from the URL's
          when the text has no translation yet and fell back to the default. */}
      <div lang={page.localeCode} className="lg:col-span-7 lg:pt-6">
        <p className="mb-8 flex items-center gap-3 text-xs tracking-[0.3em] text-muted uppercase">
          <span aria-hidden className="h-px w-10 bg-accent" />
          {t('eyebrow')}
        </p>
        <h1 className="font-display text-6xl leading-[0.95] sm:text-8xl">
          {page.title}
        </h1>
        {/* No raw HTML from the Markdown (no rehype-raw). */}
        <div className="markdown mt-12">
          <Markdown>{page.body}</Markdown>
        </div>
        <a
          href={INSTAGRAM_URL}
          target="_blank"
          rel="me noopener noreferrer"
          className="mt-14 inline-flex items-center gap-3 rounded-full border border-line px-7 py-3.5 text-sm transition-colors hover:border-paper"
        >
          {t('instagram')} <span aria-hidden>↗</span>
        </a>
      </div>
    </article>
  );
}
