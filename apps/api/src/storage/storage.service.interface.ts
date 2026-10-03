export const STORAGE_SERVICE = Symbol('STORAGE_SERVICE');

export interface UploadObjectParams {
  key: string;
  body: Buffer;
  contentType: string;
}

/**
 * Narrow port the rest of the app depends on, instead of an SDK client
 * directly — keeps ProductsService swappable/mockable, and gives a seam
 * for a genuinely different backend (e.g. local disk) later. The current
 * implementation (S3StorageService) already covers Cloudflare R2,
 * Backblaze B2, AWS S3, and MinIO through one class, since they all speak
 * the same S3 API — see its file comment for why that isn't under-engineered.
 */
export interface StorageService {
  uploadPublicObject(params: UploadObjectParams): Promise<string>;
  deleteObjectByUrl(url: string): Promise<void>;
}
