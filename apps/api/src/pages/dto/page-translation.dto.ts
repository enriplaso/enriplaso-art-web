import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class PageTranslationDto {
  @IsString()
  @IsNotEmpty()
  localeCode!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  // Markdown, rendered by the frontend. Generous cap — a privacy policy is
  // long, but nothing legitimate comes near this.
  @IsString()
  @IsNotEmpty()
  @MaxLength(100_000)
  body!: string;
}
