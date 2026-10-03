import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export async function getDefaultLocaleCode(
  prisma: PrismaService,
): Promise<string> {
  const locale = await prisma.locale.findFirst({ where: { isDefault: true } });
  if (!locale) {
    throw new BadRequestException('No default locale is configured');
  }
  return locale.code;
}

// Checked up front so an unknown code is a clear 400 naming it, rather
// than a foreign-key violation surfacing mid-transaction.
export async function assertLocalesExist(
  prisma: PrismaService,
  codes: string[],
): Promise<void> {
  const unique = [...new Set(codes)];
  if (unique.length === 0) {
    return;
  }
  const found = await prisma.locale.findMany({
    where: { code: { in: unique } },
    select: { code: true },
  });
  const known = new Set(found.map((l) => l.code));
  const missing = unique.filter((code) => !known.has(code));
  if (missing.length > 0) {
    throw new BadRequestException(
      `Unknown locale code(s): ${missing.join(', ')}`,
    );
  }
}

/**
 * The translation for the requested locale, falling back to the default
 * locale when that one is missing (README NFR5).
 */
export function pickTranslation<T extends { localeCode: string }>(
  translations: T[],
  locale: string,
  defaultLocale: string,
): T | undefined {
  return (
    translations.find((t) => t.localeCode === locale) ??
    translations.find((t) => t.localeCode === defaultLocale)
  );
}
