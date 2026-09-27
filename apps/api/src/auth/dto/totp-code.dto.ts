import { IsString, Length } from 'class-validator';

// 6 digits for a TOTP code, up to 10 chars to also allow a backup code.
export class TotpCodeDto {
  @IsString()
  @Length(6, 10)
  code!: string;
}
