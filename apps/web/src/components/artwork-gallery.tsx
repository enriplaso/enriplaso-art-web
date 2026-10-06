'use client';

import Image, { getImageProps } from 'next/image';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useRef, useState } from 'react';

// On the page, the first image is shown large (up to ~60% of the screen)
// and the rest as half-width thumbnails below it; the zoom view shows every
// image up to 1400px wide. Kept as constants because the zoom view reuses
// the page's exact image (same props → same URL → already in the browser
// cache) as an instant placeholder, and the hover prefetch must request
// exactly what the zoom view will.
const LEAD_IMAGE = {
  width: 1400,
  height: 1960,
  sizes: '(min-width: 1024px) 60vw, 100vw',
} as const;
const THUMB_IMAGE = {
  width: 700,
  height: 980,
  sizes: '(min-width: 1024px) 30vw, 50vw',
} as const;
const pageImage = (i: number) => (i === 0 ? LEAD_IMAGE : THUMB_IMAGE);
const ZOOM_SIZES = '(min-width: 1536px) 1400px, 100vw';

// How close below the visible area an image in the zoom view has to scroll
// before it starts loading (images above load once scrolled into view).
// Small on purpose: the browser's own lazy loading starts 1000–2500px early,
// which made every image in the view load at once and compete with the one
// that was clicked.
const LOAD_MARGIN = '0px 0px 300px 0px';

export interface GalleryImage {
  id: string;
  url: string;
  alt: string;
}

/**
 * A work's images on the page, like the reference gallery's product pages:
 * the first one large, loaded first and at high priority; the others as a
 * two-column grid of thumbnails that only start loading once the first one
 * has arrived (and then lazily, as they're scrolled near). Each fades in
 * when ready rather than popping in. Clicking any of them opens a
 * full-screen view where every image is shown large, wider and taller than
 * the screen, to scroll through and look at the brushwork up close. It opens
 * scrolled to the image that was clicked; clicking an image (or ×, or Esc)
 * closes it.
 *
 * The view is a native <dialog> opened with showModal(), which gives Esc to
 * close, focus moved into it and returned to the clicked image afterwards,
 * and the rest of the page made inert while it's open.
 *
 * Making it feel instant: resizing a large image takes the image optimizer
 * about a second the first time a size is asked for. So the view opens
 * showing the image the page already loaded, and fades the sharp large one in
 * over it once it arrives, and the large one starts loading as soon as the
 * pointer is over an image (or a finger touches it), before the click.
 * Only the clicked image loads on opening, at high priority. The others
 * wait until it has arrived, then load as they're scrolled near
 * (LOAD_MARGIN).
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
  // Page images: whether the first has arrived (the others wait for it),
  // and which have loaded, to fade each in.
  const [leadReady, setLeadReady] = useState(false);
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set());
  const markLoaded = (id: string) =>
    setLoaded((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  const [sharp, setSharp] = useState<ReadonlySet<string>>(new Set());
  // Indexes of the zoom-view images allowed to load: the clicked one, then
  // each one scrolled near. Reset when the view closes.
  const [near, setNear] = useState<ReadonlySet<number>>(new Set());
  const prefetched = useRef(new Set<string>());

  // Loads the zoom-size image into the browser cache: a detached <img> with
  // the same srcset/sizes picks the same file the zoom view will request.
  const prefetch = (image: GalleryImage) => {
    if (prefetched.current.has(image.id)) return;
    prefetched.current.add(image.id);
    const { props } = getImageProps({
      src: image.url,
      alt: '',
      fill: true,
      sizes: ZOOM_SIZES,
    });
    const img = new window.Image();
    if (props.sizes) img.sizes = props.sizes;
    if (props.srcSet) img.srcset = props.srcSet;
    img.src = props.src;
  };

  const open = (i: number) => {
    setOpenedAt(i);
    setNear(new Set([i]));
    dialogRef.current?.showModal();
  };
  const close = () => dialogRef.current?.close();

  // The clicked image has arrived (in this or an earlier opening), so the
  // others may start loading without competing with it.
  const clickedId = openedAt === null ? undefined : images[openedAt]?.id;
  const clickedReady = clickedId !== undefined && sharp.has(clickedId);

  // Lets an image load once it scrolls within LOAD_MARGIN of the view, but
  // only after the clicked one has arrived. The observer reports after the
  // jump to the clicked image (effect below) has happened, so the images
  // between the top and the clicked one aren't triggered on the way.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (openedAt === null || !clickedReady || !dialog) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entered = entries
          .filter((e) => e.isIntersecting)
          .map((e) => Number((e.target as HTMLElement).dataset.index));
        if (entered.length === 0) return;
        setNear((prev) => new Set([...prev, ...entered]));
      },
      { root: dialog, rootMargin: LOAD_MARGIN },
    );
    for (const el of itemRefs.current) {
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [openedAt, clickedReady]);

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

  function renderPageImage(image: GalleryImage, i: number) {
    const isLead = i === 0;
    // Thumbnails hold a painting-shaped space until the first image is in.
    if (!isLead && !leadReady) {
      return <div aria-hidden className="aspect-[5/7] w-full" />;
    }
    return (
      <button
        type="button"
        onClick={() => open(i)}
        onPointerEnter={() => prefetch(image)}
        onFocus={() => prefetch(image)}
        onTouchStart={() => prefetch(image)}
        aria-label={t('open', { alt: image.alt })}
        className="group relative flex w-full cursor-zoom-in justify-center"
      >
        <Image
          src={image.url}
          alt=""
          {...pageImage(i)}
          priority={isLead}
          loading={isLead ? undefined : 'lazy'}
          onLoad={() => {
            markLoaded(image.id);
            if (isLead) setLeadReady(true);
          }}
          // A broken first image mustn't keep the others from loading.
          onError={() => {
            if (isLead) setLeadReady(true);
          }}
          className={`h-auto object-contain transition-opacity duration-500 ${
            isLead ? 'max-h-[88svh] w-auto' : 'w-full'
          } ${loaded.has(image.id) ? 'opacity-100' : 'opacity-0'}`}
        />
        <span
          aria-hidden
          className="absolute right-3 bottom-3 flex size-10 items-center justify-center rounded-full bg-ink/70 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          <ExpandIcon />
        </span>
      </button>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-4">
        <div className="relative bg-ink-raised">
          {images[0] && renderPageImage(images[0], 0)}
          {badge}
        </div>
        {images.length > 1 && (
          <ul className="grid grid-cols-2 items-start gap-4">
            {images.slice(1).map((image, k) => (
              <li key={image.id} className="relative bg-ink-raised">
                {renderPageImage(image, k + 1)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <dialog
        ref={dialogRef}
        aria-label={t('label', { title })}
        onClose={() => {
          setOpenedAt(null);
          setNear(new Set());
        }}
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
                data-index={i}
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
                  className="relative block w-full cursor-zoom-out"
                >
                  {near.has(i) ? (
                    <>
                      {/* Underneath: the page's own image, usually already
                          cached, so something shows at once and sets the
                          height. */}
                      <Image
                        src={image.url}
                        alt=""
                        {...pageImage(i)}
                        loading="eager"
                        className="h-auto w-full"
                      />
                      {/* On top: the sharp large version, faded in when
                          ready. The clicked one jumps the network queue. */}
                      <Image
                        src={image.url}
                        alt={image.alt}
                        fill
                        sizes={ZOOM_SIZES}
                        loading="eager"
                        fetchPriority={i === openedAt ? 'high' : 'auto'}
                        // An error counts as settled too, so one broken image
                        // can't keep the others from ever loading.
                        onLoad={() =>
                          setSharp((prev) => new Set(prev).add(image.id))
                        }
                        onError={() =>
                          setSharp((prev) => new Set(prev).add(image.id))
                        }
                        className={`object-contain transition-opacity duration-300 ${
                          sharp.has(image.id) ? 'opacity-100' : 'opacity-0'
                        }`}
                      />
                    </>
                  ) : (
                    // Not loaded yet: holds a painting-shaped space so the
                    // scroll position is right, and gets replaced when it
                    // scrolls near.
                    <div
                      aria-hidden
                      className="aspect-[5/7] w-full bg-ink-raised"
                    />
                  )}
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
