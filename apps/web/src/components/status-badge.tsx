import type { ProductStatus } from '@enriplaso-art-web/api-types';

// Sold and reserved pieces stay in the portfolio (README FR1), marked rather
// than hidden. Published pieces get no badge.
export function StatusBadge({
  status,
  label,
}: {
  status: ProductStatus;
  label: (key: 'sold' | 'reserved') => string;
}) {
  if (status !== 'sold' && status !== 'reserved') {
    return null;
  }
  return (
    <span className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-ink/80 px-3 py-1 text-[11px] font-medium tracking-[0.14em] uppercase backdrop-blur">
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${status === 'sold' ? 'bg-accent' : 'bg-paper'}`}
      />
      {label(status)}
    </span>
  );
}
