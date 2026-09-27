import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CategoryTranslationDto {
  @IsString()
  @IsNotEmpty()
  localeCode!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;
}
