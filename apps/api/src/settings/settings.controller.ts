import { Controller, Get } from '@nestjs/common';
import type { Settings } from '@enriplaso-art-web/api-types';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  get(): Settings {
    return { shopEnabled: this.settingsService.isShopEnabled() };
  }
}
