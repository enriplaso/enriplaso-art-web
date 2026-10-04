import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import Markdown from 'react-markdown';
import { getPage } from '@/lib/api';
import { localeAlternates } from '@/lib/site';

// Static pages edited from the admin (About, Privacy Policy, Terms…), at
// /<locale>/<slug>. Fixed routes like /works take precedence over this one.

type Props = { params: Promise<{ locale: string; slug: string }> };

// No paths are built ahead of time (so `next build` doesn't need the whole
// catalog), but declaring this makes each page render on its first visit
// and then get cached and revalidated like the rest of the site (ISR),
// instead of being rendered on every request.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const page = await getPage(slug, locale);
  if (!page) return {};
  return {
    title: page.title,
    alternates: localeAlternates(locale, `/${page.slug}`),
  };
}

export default async function StaticPage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const page = await getPage(slug, locale);
  if (!page) notFound();

  return (
    // `lang` is the locale actually served: it differs from the URL's when
    // this page has no translation yet and fell back to the default one.
    <article
      lang={page.localeCode}
      className="mx-auto max-w-3xl px-5 pt-16 sm:px-8 sm:pt-24"
    >
      <h1 className="font-display text-6xl leading-none sm:text-8xl">
        {page.title}
      </h1>
      {/* react-markdown never renders raw HTML embedded in the Markdown
          (no rehype-raw), so page bodies can't inject markup or scripts. */}
      <div className="markdown mt-14">
        <Markdown>{page.body}</Markdown>
      </div>
    </article>
  );
}
