import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Product } from '@enriplaso-art-web/api-types';
import { Link } from '@/i18n/navigation';
import { getProduct, getProducts } from '@/lib/api';
import { localeAlternates, SITE_NAME } from '@/lib/site';
import { ArtworkCard, artworkAlt } from '@/components/artwork-card';
import { StatusBadge } from '@/components/status-badge';

type Props = { params: Promise<{ locale: string; slug: string }> };

const MORE_COUNT = 4;

// No paths are built ahead of time (so `next build` doesn't need the whole
// catalog), but declaring this makes each page render on its first visit
// and then get cached and revalidated like the rest of the site (ISR),
// instead of being rendered on every request.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  // Same URL as the page's own call, so Next serves it from one fetch.
  const work = await getProduct(slug, locale);
  if (!work) return {};

  const description = work.description ?? artworkAlt(work);
  return {
    title: work.title,
    description,
    alternates: localeAlternates(locale, `/works/${work.slug}`),
    openGraph: {
      title: `${work.title} — ${SITE_NAME}`,
      description,
      images: work.primaryImageUrl ? [{ url: work.primaryImageUrl }] : [],
    },
  };
}

function formatDimensions(work: Product, locale: string): string | null {
  const sides = [work.widthCm, work.heightCm, work.depthCm].filter(
    (n): n is number => n !== null,
  );
  if (sides.length < 2) return null;
  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  return `${sides.map((n) => nf.format(n)).join(' × ')} cm`;
}

export default async function WorkPage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const [work, { data: all }] = await Promise.all([
    getProduct(slug, locale),
    getProducts({ locale, pageSize: 100 }),
  ]);
  if (!work) notFound();

  const t = await getTranslations('Work');
  const tStatus = await getTranslations('Status');

  // Prev/next walk the same order as the works page; "more" continues from
  // here (wrapping around), so it differs from piece to piece.
  const index = all.findIndex((w) => w.id === work.id);
  const prev = index > 0 ? all[index - 1] : undefined;
  const next = index >= 0 && index < all.length - 1 ? all[index + 1] : undefined;
  const more = all.length > 1
    ? Array.from({ length: Math.min(MORE_COUNT, all.length - 1) }, (_, i) =>
        all[(Math.max(index, 0) + 1 + i) % all.length],
      ).filter((w): w is Product => w !== undefined && w.id !== work.id)
    : [];

  const dimensions = formatDimensions(work, locale);
  const details = [
    work.medium && { label: t('medium'), value: work.medium },
    dimensions && { label: t('dimensions'), value: dimensions },
    work.yearCreated && { label: t('year'), value: String(work.yearCreated) },
  ].filter((d): d is { label: string; value: string } => Boolean(d));

  // Structured data, so search engines understand this is an artwork by
  // this artist rather than a generic page.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'VisualArtwork',
    name: work.title,
    image: work.primaryImageUrl ?? undefined,
    description: work.description ?? artworkAlt(work),
    artform: 'Painting',
    artMedium: work.medium ?? undefined,
    dateCreated: work.yearCreated ? String(work.yearCreated) : undefined,
    creator: { '@type': 'Person', name: SITE_NAME },
  };

  return (
    <article className="mx-auto max-w-[1600px] px-5 pt-10 sm:px-8 sm:pt-14">
      <script
        type="application/ld+json"
        // JSON.stringify output, with "<" escaped so a title can't close
        // the script tag.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
        }}
      />

      <Link
        href="/works"
        className="text-sm text-muted transition-colors hover:text-paper"
      >
        ← {t('back')}
      </Link>

      <div className="mt-8 grid gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-7 xl:col-span-8">
          {work.images.length > 0 ? (
            <ul className="flex flex-col gap-8">
              {work.images.map((image, i) => (
                <li key={image.id} className="relative flex justify-center bg-ink-raised">
                  <Image
                    src={image.url}
                    alt={image.altText ?? work.title}
                    width={1400}
                    height={1960}
                    priority={i === 0}
                    sizes="(min-width: 1024px) 60vw, 100vw"
                    className="h-auto max-h-[88svh] w-auto object-contain"
                  />
                  {i === 0 && <StatusBadge status={work.status} label={tStatus} />}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="lg:col-span-5 xl:col-span-4">
          <div className="lg:sticky lg:top-28">
            <h1 className="font-display text-6xl leading-[0.95] sm:text-7xl">
              {work.title}
            </h1>
            <p className="mt-4 text-sm tracking-[0.2em] text-muted uppercase">
              {SITE_NAME}
            </p>

            {work.description && (
              <p className="mt-10 text-lg leading-relaxed whitespace-pre-line text-paper/85">
                {work.description}
              </p>
            )}

            <dl className="mt-10 divide-y divide-line border-y border-line text-sm">
              {details.map((d) => (
                <div key={d.label} className="flex justify-between gap-6 py-4">
                  <dt className="text-muted">{d.label}</dt>
                  <dd className="text-right">{d.value}</dd>
                </div>
              ))}
              {work.isUnique && (
                <div className="py-4 text-muted">{t('original')}</div>
              )}
            </dl>

            <nav className="mt-10 flex justify-between gap-6 text-sm">
              {prev ? (
                <Link
                  href={`/works/${prev.slug}`}
                  className="group flex flex-col gap-1"
                >
                  <span className="text-muted">← {t('previous')}</span>
                  <span className="font-display text-xl transition-colors group-hover:text-accent">
                    {prev.title}
                  </span>
                </Link>
              ) : (
                <span />
              )}
              {next && (
                <Link
                  href={`/works/${next.slug}`}
                  className="group flex flex-col items-end gap-1 text-right"
                >
                  <span className="text-muted">{t('next')} →</span>
                  <span className="font-display text-xl transition-colors group-hover:text-accent">
                    {next.title}
                  </span>
                </Link>
              )}
            </nav>
          </div>
        </div>
      </div>

      {more.length > 0 && (
        <section aria-labelledby="more-heading" className="mt-32">
          <h2
            id="more-heading"
            className="mb-12 border-t border-line pt-10 font-display text-5xl"
          >
            {t('more')}
          </h2>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-4">
            {more.map((w) => (
              <li key={w.id}>
                <ArtworkCard
                  product={w}
                  sizes="(min-width: 1024px) 24vw, 50vw"
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
