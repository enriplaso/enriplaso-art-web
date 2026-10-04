import { useTranslations } from 'next-intl';
import { INSTAGRAM_URL } from '@/lib/site';

// rel="me" tells search engines and other sites that this profile belongs to
// the same person as this site.
export function InstagramLink({ className = '' }: { className?: string }) {
  const t = useTranslations('Nav');

  return (
    <a
      href={INSTAGRAM_URL}
      target="_blank"
      rel="me noopener noreferrer"
      aria-label={t('instagram')}
      title={t('instagram')}
      className={`inline-flex size-9 items-center justify-center rounded-full text-paper/80 transition-colors hover:text-accent ${className}`}
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-5"
      >
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
      </svg>
    </a>
  );
}
