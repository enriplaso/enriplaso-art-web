'use client';

import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useRef, useState } from 'react';

export interface GalleryImage {
  id: string;
  url: string;
  alt: string;
}

/**
 * A work's images stacked on the page; clicking any of them opens a
 * full-screen view where every image is shown large, wider and taller than
 * the screen, to scroll through and look at the brushwork up close. It opens
 * scrolled to the image that was clicked; clicking an image (or ×, or Esc)
 * closes it.
 *
 * The view is a native <dialog> opened with showModal(), which gives Esc to
 * close, focus moved into it and returned to the clicked image afterwards,
 * and the rest of the page made inert while it's open.
 */
export function ArtworkGallery({
  images,
  title,
  badge,
}: {
  images: GalleryImage[];
  title: string;
  /** Shown over the first image, e.g. the "Sold" badge. */
  badge?: ReactNode;
}) {
  const t = useTranslations('Lightbox');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const [openedAt, setOpenedAt] = useState<number | null>(null);

  const open = (i: number) => {
    setOpenedAt(i);
    dialogRef.current?.showModal();
  };
  const close = () => dialogRef.current?.close();

  // Once the large images are rendered: jump to the one that was clicked,
  // and keep the page behind from scrolling.
  useEffect(() => {
    if (openedAt === null) return;
    itemRefs.current[openedAt]?.scrollIntoView({ block: 'start' });
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = previousOverflow;
    };
  }, [openedAt]);

  // Touch browsers treat a sideways swipe as "go back a page", which would
  // leave the site mid-zoom. CSS (overscroll-behavior) can't stop that from
  // inside a modal dialog, so a sideways single-finger move is cancelled
  // here, but only while the page isn't pinch-zoomed: once zoomed in, a
  // sideways drag is panning around the painting and must keep working.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    let start: { x: number; y: number } | null = null;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      start = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY } : null;
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      const zoomed = (window.visualViewport?.scale ?? 1) > 1.01;
      if (!start || !t || zoomed || e.touches.length > 1) return;
      const dx = Math.abs(t.clientX - start.x);
      const dy = Math.abs(t.clientY - start.y);
      if (dx > dy && e.cancelable) e.preventDefault();
    };
    dialog.addEventListener('touchstart', onStart, { passive: true });
    // Non-passive: preventDefault() is ignored in a passive listener.
    dialog.addEventListener('touchmove', onMove, { passive: false });
    return () => {
      dialog.removeEventListener('touchstart', onStart);
      dialog.removeEventListener('touchmove', onMove);
    };
  }, []);

  return (
    <>
      <ul className="flex flex-col gap-8">
        {images.map((image, i) => (
          <li key={image.id} className="relative bg-ink-raised">
            <button
              type="button"
              onClick={() => open(i)}
              aria-label={t('open', { alt: image.alt })}
              className="group flex w-full cursor-zoom-in justify-center"
            >
              <Image
                src={image.url}
                alt=""
                width={1400}
                height={1960}
                priority={i === 0}
                sizes="(min-width: 1024px) 60vw, 100vw"
                className="h-auto max-h-[88svh] w-auto object-contain"
              />
              <span
                aria-hidden
                className="absolute right-3 bottom-3 flex size-10 items-center justify-center rounded-full bg-ink/70 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              >
                <ExpandIcon />
              </span>
            </button>
            {i === 0 && badge}
          </li>
        ))}
      </ul>

      <dialog
        ref={dialogRef}
        aria-label={t('label', { title })}
        onClose={() => setOpenedAt(null)}
        // overscroll-contain: scrolling past the last image doesn't scroll
        // the page behind.
        className="m-0 h-dvh max-h-none w-screen max-w-none overflow-y-auto overscroll-contain bg-ink p-0 text-paper backdrop:bg-ink"
      >
        <button
          type="button"
          onClick={close}
          aria-label={t('close')}
          autoFocus
          className="fixed top-4 right-4 z-10 flex size-11 items-center justify-center rounded-full border border-paper/20 bg-ink/70 backdrop-blur transition-colors hover:bg-paper hover:text-ink sm:top-6 sm:right-6"
        >
          <CloseIcon />
        </button>

        {openedAt !== null && (
          <ul className="mx-auto flex max-w-[1400px] flex-col gap-4 sm:gap-6 sm:px-[6vw] sm:py-6">
            {images.map((image, i) => (
              <li
                key={image.id}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
              >
                {/* The image itself is the zoom-out target, like a print
                    you put back down; × and Esc close too. */}
                <button
                  type="button"
                  onClick={close}
                  tabIndex={-1}
                  className="block w-full cursor-zoom-out"
                >
                  <Image
                    src={image.url}
                    alt={image.alt}
                    width={1400}
                    height={1960}
                    sizes="(min-width: 1536px) 1400px, 100vw"
                    quality={90}
                    loading={i === openedAt ? 'eager' : 'lazy'}
                    className="h-auto w-full"
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </dialog>
    </>
  );
}

function CloseIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      className="size-5"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
    >
      <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
    </svg>
  );
}
