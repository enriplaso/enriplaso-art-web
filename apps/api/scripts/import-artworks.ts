/**
 * Bulk-imports artworks through the running API — the same endpoints the
 * admin UI will use, so validation, image storage and slugs behave exactly
 * as they would for a hand-entered piece. Meant for loading a batch of
 * photographed works until the admin UI exists.
 *
 *   IMPORT_ADMIN_EMAIL=... IMPORT_ADMIN_PASSWORD=... \
 *     npm run import:artworks -w apps/api -- <folder>
 *
 * <folder> holds the images plus a manifest.json:
 *   [{ "slug": "el-guardian", "title": "El guardián",
 *      "image": "el-guardian.jpg", "altText": "A grey wolf…" }, …]
 *
 * Each entry is created as a draft, gets its image (as the primary one, with
 * the alt text in the default locale), and is then published. Re-running is
 * safe: an entry whose slug already exists is skipped. The admin account
 * must not have 2FA enabled (there's no way to type a code here).
 */
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

interface ManifestEntry {
  slug: string;
  title: string;
  image: string;
  altText?: string;
  medium?: string;
  yearCreated?: number;
  widthCm?: number;
  heightCm?: number;
}

const API_URL = process.env.IMPORT_API_URL ?? 'http://localhost:3001';

async function main() {
  const folder = process.argv[2];
  const email = process.env.IMPORT_ADMIN_EMAIL;
  const password = process.env.IMPORT_ADMIN_PASSWORD;
  if (!folder || !email || !password) {
    throw new Error(
      'Usage: IMPORT_ADMIN_EMAIL=... IMPORT_ADMIN_PASSWORD=... npm run import:artworks -w apps/api -- <folder>',
    );
  }

  const manifest = JSON.parse(
    await readFile(path.join(folder, 'manifest.json'), 'utf8'),
  ) as ManifestEntry[];

  const cookie = await login(email, password);
  let created = 0;
  let skipped = 0;

  for (const entry of manifest) {
    const res = await fetch(`${API_URL}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        slug: entry.slug,
        title: entry.title,
        medium: entry.medium,
        yearCreated: entry.yearCreated,
        widthCm: entry.widthCm,
        heightCm: entry.heightCm,
        // Required by the API. Prices aren't shown while SHOP_ENABLED is off;
        // set real ones before turning the shop on.
        priceCents: 0,
      }),
    });
    if (res.status === 409) {
      console.log(`skip    ${entry.slug} (already exists)`);
      skipped++;
      continue;
    }
    const product = (await expectOk(res, `create ${entry.slug}`)) as {
      id: string;
    };

    const form = new FormData();
    const bytes = await readFile(path.join(folder, entry.image));
    form.append(
      'file',
      new Blob([bytes], { type: mimeType(entry.image) }),
      entry.image,
    );
    form.append('isPrimary', 'true');
    if (entry.altText) form.append('altText', entry.altText);
    await expectOk(
      await fetch(`${API_URL}/products/${product.id}/images`, {
        method: 'POST',
        headers: { Cookie: cookie },
        body: form,
      }),
      `upload image for ${entry.slug}`,
    );

    await expectOk(
      await fetch(`${API_URL}/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ status: 'published' }),
      }),
      `publish ${entry.slug}`,
    );

    console.log(`created ${entry.slug}`);
    created++;
  }

  console.log(`\nDone: ${created} created, ${skipped} skipped.`);
}

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await expectOk(res, 'login')) as {
    requiresTwoFactor: boolean;
  };
  if (body.requiresTwoFactor) {
    throw new Error('This admin has 2FA enabled; use one without it.');
  }
  const session = res.headers
    .getSetCookie()
    .find((c) => c.startsWith('access_token='));
  if (!session) {
    throw new Error('Login succeeded but no session cookie was set');
  }
  // "access_token=…; Path=/; HttpOnly" → "access_token=…"
  return session.split(';')[0] ?? session;
}

async function expectOk(res: Response, what: string): Promise<unknown> {
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${what} failed: ${res.status} ${text}`);
  }
  return text ? JSON.parse(text) : undefined;
}

function mimeType(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
