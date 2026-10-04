import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getProducts } from '@/lib/api';
import { localeAlternates } from '@/lib/site';
import { ArtworkCard } from '@/components/artwork-card';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Works' });
  return {
    title: t('title'),
    description: t('intro'),
    alternates: localeAlternates(locale, '/works'),
  };
}

export default async function WorksPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Works');
  const { data: works, total } = await getProducts({ locale, pageSize: 100 });

  return (
    <div className="mx-auto max-w-[1600px] px-5 pt-16 sm:px-8 sm:pt-24">
      <header className="mb-16 flex flex-col gap-6 border-b border-line pb-10 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-7xl leading-none sm:text-9xl">
            {t('title')}
          </h1>
          <p className="mt-6 text-lg text-paper/75">{t('intro')}</p>
        </div>
        <p className="text-sm tracking-[0.2em] text-muted uppercase">
          {t('count', { count: total })}
        </p>
      </header>

      {works.length === 0 ? (
        <p className="text-muted">{t('empty')}</p>
      ) : (
        // CSS columns: a masonry hang where each painting keeps its own
        // proportions.
        <ul className="columns-1 gap-8 sm:columns-2 lg:columns-3 2xl:columns-4">
          {works.map((work, i) => (
            <li key={work.id} className="mb-14 break-inside-avoid">
              <ArtworkCard
                product={work}
                priority={i < 3}
                sizes="(min-width: 1536px) 24vw, (min-width: 1024px) 32vw, (min-width: 640px) 50vw, 100vw"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
