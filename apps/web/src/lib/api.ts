import type {
  Category,
  Page,
  PageSummary,
  Paginated,
  Product,
} from '@enriplaso-art-web/api-types';

// Server-side only: every call happens in Server Components, so the API URL
// never needs to reach the browser. API_URL lets the server use an internal
// address in production (e.g. a private network hostname).
const API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001';

// How long Next caches an API response before refetching it in the
// background. Short enough that a newly published painting appears within
// minutes, long enough that the API isn't hit on every page view.
const REVALIDATE_SECONDS = 300;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    path: string,
  ) {
    super(`API ${path} responded ${status}`);
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    next: { revalidate: REVALIDATE_SECONDS },
  });
  if (!res.ok) {
    throw new ApiError(res.status, path);
  }
  return (await res.json()) as T;
}

// For lookups by slug: a 404 is an expected answer ("no such page"), not a
// failure, so it becomes null and the page can call notFound().
async function getOrNull<T>(path: string): Promise<T | null> {
  try {
    return await get<T>(path);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export function getProducts(params: {
  locale: string;
  pageSize?: number;
  page?: number;
  categorySlug?: string;
  search?: string;
}): Promise<Paginated<Product>> {
  return get(`/products${query(params)}`);
}

export function getProduct(
  slug: string,
  locale: string,
): Promise<Product | null> {
  return getOrNull(`/products/${encodeURIComponent(slug)}${query({ locale })}`);
}

export function getCategories(locale: string): Promise<Category[]> {
  return get(`/categories${query({ locale })}`);
}

export function getPages(locale: string): Promise<PageSummary[]> {
  return get(`/pages${query({ locale })}`);
}

export function getPage(slug: string, locale: string): Promise<Page | null> {
  return getOrNull(`/pages/${encodeURIComponent(slug)}${query({ locale })}`);
}
