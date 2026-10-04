import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class QueryProductsDto {
  @IsOptional()
  @IsString()
  categorySlug?: string;

  @IsOptional()
  @IsString()
  tag?: string;

  // Typo-tolerant match against title/medium/style/description, ranked by
  // relevance (pg_trgm) — see README's "Search" section.
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  locale?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
