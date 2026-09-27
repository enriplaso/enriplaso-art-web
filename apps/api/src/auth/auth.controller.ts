import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { TotpCodeDto } from './dto/totp-code.dto';
import { AdminAuthGuard } from './admin-auth.guard';
import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_MAX_AGE_MS,
  PENDING_2FA_TOKEN_COOKIE,
  PENDING_2FA_TOKEN_MAX_AGE_MS,
  getAuthCookieOptions,
} from './auth.constants';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto.email, dto.password);

    if (result.requiresTwoFactor) {
      res.cookie(PENDING_2FA_TOKEN_COOKIE, result.pendingToken, {
        ...getAuthCookieOptions(),
        maxAge: PENDING_2FA_TOKEN_MAX_AGE_MS,
      });
      return { requiresTwoFactor: true };
    }

    res.cookie(ACCESS_TOKEN_COOKIE, result.token, {
      ...getAuthCookieOptions(),
      maxAge: ACCESS_TOKEN_MAX_AGE_MS,
    });
    return { admin: result.admin };
  }

  @Post('2fa/verify')
  async verifyTwoFactor(
    @Body() dto: TotpCodeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const pendingToken = req.cookies?.[PENDING_2FA_TOKEN_COOKIE] as
      string | undefined;
    if (!pendingToken) {
      throw new UnauthorizedException('No pending login attempt');
    }

    const result = await this.authService.verifyTwoFactor(
      pendingToken,
      dto.code,
    );

    res.clearCookie(PENDING_2FA_TOKEN_COOKIE, getAuthCookieOptions());
    res.cookie(ACCESS_TOKEN_COOKIE, result.token, {
      ...getAuthCookieOptions(),
      maxAge: ACCESS_TOKEN_MAX_AGE_MS,
    });

    return { admin: result.admin, usedBackupCode: result.usedBackupCode };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(ACCESS_TOKEN_COOKIE, getAuthCookieOptions());
    return { success: true };
  }

  @Get('me')
  @UseGuards(AdminAuthGuard)
  me(@Req() req: Request) {
    return this.authService.getProfile(req.admin!.sub);
  }

  @Post('2fa/setup')
  @UseGuards(AdminAuthGuard)
  setupTwoFactor(@Req() req: Request) {
    return this.authService.setupTotp(req.admin!.sub);
  }

  @Post('2fa/confirm')
  @UseGuards(AdminAuthGuard)
  confirmTwoFactor(@Req() req: Request, @Body() dto: TotpCodeDto) {
    return this.authService.confirmTotp(req.admin!.sub, dto.code);
  }

  @Post('2fa/disable')
  @UseGuards(AdminAuthGuard)
  disableTwoFactor(@Req() req: Request) {
    return this.authService.disableTotp(req.admin!.sub);
  }
}
