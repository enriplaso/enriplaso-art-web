import Image from 'next/image';
import { useTranslations } from 'next-intl';
import type { Product } from '@enriplaso-art-web/api-types';
import { Link } from '@/i18n/navigation';
import { StatusBadge } from './status-badge';

export function artworkAlt(product: Product): string {
  return product.images[0]?.altText ?? product.title;
}

/**
 * One painting in a grid: the image at its natural proportions (the
 * width/height below only reserve space; `h-auto` lets the real ratio win),
 * with the title underneath.
 */
export function ArtworkCard({
  product,
  sizes,
  priority = false,
}: {
  product: Product;
  sizes: string;
  priority?: boolean;
}) {
  const t = useTranslations('Status');

  return (
    <Link
      href={`/works/${product.slug}`}
      className="group block break-inside-avoid"
    >
      <div className="relative overflow-hidden bg-ink-raised">
        {product.primaryImageUrl && (
          <Image
            src={product.primaryImageUrl}
            alt={artworkAlt(product)}
            width={1000}
            height={1400}
            sizes={sizes}
            priority={priority}
            className="h-auto w-full transition duration-700 ease-out group-hover:scale-[1.03]"
          />
        )}
        <StatusBadge status={product.status} label={t} />
      </div>
      <p className="mt-3 font-display text-xl leading-tight transition-colors group-hover:text-accent">
        {product.title}
      </p>
    </Link>
  );
}
