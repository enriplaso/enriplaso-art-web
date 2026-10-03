import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  StorageService,
  UploadObjectParams,
} from './storage.service.interface';

/**
 * Cloudflare R2, Backblaze B2, AWS S3, and MinIO (used for local dev/e2e —
 * see docker-compose.yml) all implement the same S3 API, so one client
 * covers every one of them. Swapping provider is an env var change
 * (STORAGE_ENDPOINT/REGION/credentials), not a code change — see README's
 * "Image storage" section for the per-provider values. A per-provider
 * adapter class would just duplicate this one for no behavioral difference.
 */
@Injectable()
export class S3StorageService implements StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicUrlBase: string;

  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>('STORAGE_BUCKET');
    this.publicUrlBase = config
      .getOrThrow<string>('STORAGE_PUBLIC_URL_BASE')
      .replace(/\/+$/, '');

    this.client = new S3Client({
      endpoint: config.getOrThrow<string>('STORAGE_ENDPOINT'),
      region: config.get<string>('STORAGE_REGION') ?? 'auto',
      // MinIO (local dev) needs path-style requests; R2/B2/S3 accept it too,
      // so this is the one setting safe to default on rather than per-provider.
      forcePathStyle:
        config.get<string>('STORAGE_FORCE_PATH_STYLE') !== 'false',
      credentials: {
        accessKeyId: config.getOrThrow<string>('STORAGE_ACCESS_KEY_ID'),
        secretAccessKey: config.getOrThrow<string>('STORAGE_SECRET_ACCESS_KEY'),
      },
    });
  }

  async uploadPublicObject({
    key,
    body,
    contentType,
  }: UploadObjectParams): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return `${this.publicUrlBase}/${key}`;
  }

  async deleteObjectByUrl(url: string): Promise<void> {
    if (!url.startsWith(`${this.publicUrlBase}/`)) {
      // Not an object this bucket owns (e.g. a hand-seeded URL) — nothing
      // to delete remotely, and guessing a key from it would be unsafe.
      return;
    }
    const key = url.slice(this.publicUrlBase.length + 1);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}
