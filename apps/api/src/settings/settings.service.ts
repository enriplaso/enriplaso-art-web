import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Single source of truth for SHOP_ENABLED (README's "Feature flag"
 * section): the API enforces it, and the frontend reads it from
 * GET /settings instead of keeping its own copy that could drift.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly config: ConfigService) {}

  isShopEnabled(): boolean {
    return this.config.get<string>('SHOP_ENABLED') === 'true';
  }
}
