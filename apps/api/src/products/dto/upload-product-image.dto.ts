import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

// multipart/form-data fields all arrive as strings, so booleans/numbers
// need an explicit coercion before validation runs.
export class UploadProductImageDto {
  // Stored as the default-locale translation; other locales are added
  // afterwards via PATCH (multipart can't comfortably carry an array).
  @IsOptional()
  @IsString()
  altText?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === '' ? undefined : Number(value),
  )
  @IsInt()
  @Min(0)
  position?: number;
}
