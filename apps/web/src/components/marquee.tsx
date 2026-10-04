import Image from 'next/image';
import type { Product } from '@enriplaso-art-web/api-types';
import { Link } from '@/i18n/navigation';
import { artworkAlt } from './artwork-card';

/**
 * An endless, slowly drifting strip of every painting. The list is rendered
 * twice and the track slides by exactly half its width, so the loop has no
 * visible seam. Pauses on hover/focus; stops entirely for visitors who
 * prefer reduced motion (globals.css). The second copy is hidden from
 * assistive tech and the tab order, so each work is announced once.
 */
export function Marquee({ products }: { products: Product[] }) {
  const items = products.filter((p) => p.primaryImageUrl);
  if (items.length === 0) return null;

  return (
    <div className="group overflow-hidden">
      <div className="flex w-max animate-marquee gap-4 group-focus-within:[animation-play-state:paused] group-hover:[animation-play-state:paused]">
        {[0, 1].map((copy) => (
          <ul
            key={copy}
            aria-hidden={copy === 1 ? true : undefined}
            className="flex gap-4"
          >
            {items.map((product) => (
              <li key={product.id} className="shrink-0">
                <Link
                  href={`/works/${product.slug}`}
                  tabIndex={copy === 1 ? -1 : undefined}
                  className="block"
                >
                  <Image
                    src={product.primaryImageUrl!}
                    alt={copy === 0 ? artworkAlt(product) : ''}
                    width={200}
                    height={280}
                    sizes="200px"
                    className="h-56 w-auto opacity-80 transition-opacity duration-500 hover:opacity-100 sm:h-72"
                  />
                </Link>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}
