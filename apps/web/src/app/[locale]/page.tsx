import Image from 'next/image';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getPages, getProducts } from '@/lib/api';
import { HERO_SLUG } from '@/lib/site';
import { ArtworkCard, artworkAlt } from '@/components/artwork-card';
import { Marquee } from '@/components/marquee';

const SELECTED_COUNT = 6;

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Home');

  // The whole catalog fits in one page (well under 100 works).
  const [{ data: works, total }, pages] = await Promise.all([
    getProducts({ locale, pageSize: 100 }),
    getPages(locale),
  ]);
  const hero = works.find((w) => w.slug === HERO_SLUG) ?? works[0];
  const selected = works
    .filter((w) => w.id !== hero?.id)
    .slice(0, SELECTED_COUNT);
  const hasAboutPage = pages.some((p) => p.slug === 'about');

  return (
    <>
      {/* Hero: name set large, with one painting given the room it needs. */}
      <section className="mx-auto grid max-w-[1600px] items-end gap-12 px-5 pt-12 pb-20 sm:px-8 lg:min-h-[calc(100svh-4rem)] lg:grid-cols-12 lg:pt-16">
        <div className="lg:col-span-7 lg:pb-10">
          <p className="mb-8 flex items-center gap-3 text-xs tracking-[0.3em] text-muted uppercase">
            <span aria-hidden className="h-px w-10 bg-accent" />
            {t('eyebrow')}
          </p>
          <h1 className="font-display text-[clamp(4.5rem,15vw,13.5rem)] leading-[0.82] tracking-[-0.02em]">
            Enrique
            <br />
            <em className="text-accent">Plaza</em>
          </h1>
          <p className="mt-10 max-w-md text-lg leading-relaxed text-paper/80 sm:text-xl">
            {t('intro')}
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link
              href="/works"
              className="rounded-full bg-paper px-7 py-3.5 text-sm font-medium text-ink transition-colors hover:bg-accent"
            >
              {t('viewWorks')}
            </Link>
            {hasAboutPage && (
              <Link
                href="/about"
                className="rounded-full border border-line px-7 py-3.5 text-sm transition-colors hover:border-paper"
              >
                {t('about')}
              </Link>
            )}
          </div>
        </div>

        {hero?.primaryImageUrl && (
          <figure className="lg:col-span-5">
            <Link href={`/works/${hero.slug}`} className="group block">
              <div className="overflow-hidden">
                <Image
                  src={hero.primaryImageUrl}
                  alt={artworkAlt(hero)}
                  width={1000}
                  height={1400}
                  priority
                  sizes="(min-width: 1024px) 40vw, 100vw"
                  className="h-auto max-h-[78svh] w-full object-contain object-bottom transition duration-700 group-hover:scale-[1.02]"
                />
              </div>
              <figcaption className="mt-4 flex items-baseline justify-between gap-4 text-sm text-muted">
                <span className="tracking-[0.2em] uppercase">
                  {t('featured')}
                </span>
                <span className="font-display text-xl text-paper transition-colors group-hover:text-accent">
                  {hero.title}
                </span>
              </figcaption>
            </Link>
          </figure>
        )}
      </section>

      <Marquee products={works} />

      {selected.length > 0 && (
        <section
          aria-labelledby="selected-heading"
          className="mx-auto max-w-[1600px] px-5 pt-32 sm:px-8"
        >
          <div className="mb-14 flex items-end justify-between gap-6">
            <h2
              id="selected-heading"
              className="font-display text-5xl leading-none sm:text-7xl"
            >
              {t('selected')}
            </h2>
            <Link
              href="/works"
              className="hidden shrink-0 text-sm text-muted underline-offset-8 transition-colors hover:text-paper hover:underline sm:block"
            >
              {t('viewAll')} →
            </Link>
          </div>
          {/* Offset columns: the middle one starts lower, so the grid reads
              as a hang on a wall rather than a spreadsheet. */}
          <ul className="grid gap-x-8 gap-y-16 sm:grid-cols-2 lg:grid-cols-3">
            {selected.map((work, i) => (
              <li key={work.id} className={i % 3 === 1 ? 'lg:mt-24' : ''}>
                <ArtworkCard
                  product={work}
                  sizes="(min-width: 1024px) 30vw, (min-width: 640px) 50vw, 100vw"
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mx-auto max-w-[1600px] px-5 pt-32 sm:px-8">
        <div className="grid gap-10 border-t border-line pt-12 md:grid-cols-12">
          <h2 className="text-xs tracking-[0.3em] text-muted uppercase md:col-span-3">
            {t('collectionTitle')}
          </h2>
          <div className="md:col-span-9">
            <p className="font-display text-5xl leading-[1.05] sm:text-7xl">
              {t('collectionCount', { count: total })}.{' '}
              <span className="text-muted">{t('collectionText')}</span>
            </p>
            <Link
              href="/works"
              className="mt-10 inline-flex items-center gap-3 text-lg transition-colors hover:text-accent"
            >
              {t('explore')} <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
