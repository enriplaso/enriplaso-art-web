import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export default function NotFound() {
  const t = useTranslations('NotFound');

  return (
    <div className="mx-auto max-w-[1600px] px-5 py-32 sm:px-8">
      <p className="font-display text-[clamp(6rem,20vw,16rem)] leading-none text-accent">
        404
      </p>
      <h1 className="mt-6 font-display text-5xl">{t('title')}</h1>
      <p className="mt-4 max-w-md text-lg text-paper/75">{t('text')}</p>
      <Link
        href="/"
        className="mt-10 inline-block rounded-full bg-paper px-7 py-3.5 text-sm font-medium text-ink transition-colors hover:bg-accent"
      >
        {t('home')}
      </Link>
    </div>
  );
}
