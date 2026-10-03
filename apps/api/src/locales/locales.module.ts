import { Module } from '@nestjs/common';
import { LocalesController } from './locales.controller';
import { LocalesService } from './locales.service';

@Module({
  controllers: [LocalesController],
  providers: [LocalesService],
})
export class LocalesModule {}
