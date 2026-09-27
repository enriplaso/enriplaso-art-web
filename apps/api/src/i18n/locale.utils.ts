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
