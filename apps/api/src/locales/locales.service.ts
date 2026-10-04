import { Injectable } from '@nestjs/common';
import type { Locale } from '@enriplaso-art-web/api-types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LocalesService {
  constructor(private readonly prisma: PrismaService) {}

  // Default locale first, so a client can treat the first entry as the
  // fallback without scanning for isDefault.
  findActive(): Promise<Locale[]> {
    return this.prisma.locale.findMany({
      where: { isActive: true },
      select: { code: true, name: true, isDefault: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }
}
