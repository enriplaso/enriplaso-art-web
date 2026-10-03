import { Module } from '@nestjs/common';
import { S3StorageService } from './s3-storage.service';
import { STORAGE_SERVICE } from './storage.service.interface';

@Module({
  providers: [{ provide: STORAGE_SERVICE, useClass: S3StorageService }],
  exports: [STORAGE_SERVICE],
})
export class StorageModule {}
