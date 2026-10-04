import { randomBytes } from 'crypto';
import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import type {
  AdminProfile,
  AdminSummary,
  SuccessResponse,
  TotpConfirmResponse,
  TotpSetupResponse,
} from '@enriplaso-art-web/api-types';
import { PrismaService } from '../prisma/prisma.service';
import {
  BACKUP_CODE_COUNT,
  LOCKOUT_DURATION_MS,
  MAX_FAILED_LOGIN_ATTEMPTS,
  PENDING_2FA_PURPOSE,
  PENDING_2FA_TOKEN_EXPIRES_IN,
} from './auth.constants';

const TOTP_ISSUER = 'Art Shop Admin';

// Internal: the tokens are set as cookies by AuthController and never
// reach the response body (see LoginResponse in @enriplaso-art-web/api-types).
type LoginResult =
  | { requiresTwoFactor: true; pendingToken: string }
  | { requiresTwoFactor: false; token: string; admin: AdminSummary };

@Injectable()
export class AuthService {
  // Security events only — who logged in, failed, got locked out, or
  // changed 2FA. Never codes, tokens, secrets, or passwords.
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const admin = await this.prisma.admin.findUnique({ where: { email } });

    if (!admin) {
      this.logger.warn({ email }, 'Login failed: unknown email');
      throw new UnauthorizedException('Invalid email or password');
    }

    this.assertNotLocked(admin);

    if (!(await bcrypt.compare(password, admin.passwordHash))) {
      await this.registerFailedAttempt(admin, 'wrong password');
      throw new UnauthorizedException('Invalid email or password');
    }

    if (admin.totpEnabled) {
      // Password step succeeded, but the login isn't complete — the
      // failure counter deliberately isn't reset yet, so an attacker who
      // already has the password can't get unlimited tries at the 2FA
      // code just because each of their password attempts "succeeded".
      const pendingToken = await this.jwtService.signAsync(
        { sub: admin.id, purpose: PENDING_2FA_PURPOSE },
        { expiresIn: PENDING_2FA_TOKEN_EXPIRES_IN },
      );
      this.logger.log(
        { adminId: admin.id },
        'Password accepted, awaiting 2FA code',
      );
      return { requiresTwoFactor: true, pendingToken };
    }

    // Only reached when 2FA isn't enabled — otherwise lastLoginAt (and the
    // lockout reset) happens in verifyTwoFactor, once login is complete.
    await this.prisma.admin.update({
      where: { id: admin.id },
      data: {
        lastLoginAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    const token = await this.signSessionToken(admin.id, admin.email);
    this.logger.log({ adminId: admin.id }, 'Admin logged in (password only)');

    return {
      requiresTwoFactor: false,
      token,
      admin: { id: admin.id, email: admin.email, fullName: admin.fullName },
    };
  }

  async verifyTwoFactor(
    pendingToken: string,
    code: string,
  ): Promise<{ token: string; usedBackupCode: boolean; admin: AdminSummary }> {
    let payload: { sub: string; purpose?: string };
    try {
      payload = await this.jwtService.verifyAsync<{
        sub: string;
        purpose?: string;
      }>(pendingToken);
    } catch {
      this.logger.warn('2FA step rejected: invalid or expired pending token');
      throw new UnauthorizedException('Invalid or expired login attempt');
    }

    if (payload.purpose !== PENDING_2FA_PURPOSE) {
      this.logger.warn(
        { adminId: payload.sub },
        '2FA step rejected: token is not a pending-2FA token',
      );
      throw new UnauthorizedException('Invalid login attempt');
    }

    const admin = await this.prisma.admin.findUnique({
      where: { id: payload.sub },
    });

    if (!admin?.totpEnabled || !admin.totpSecret) {
      throw new UnauthorizedException(
        'Two-factor authentication is not set up',
      );
    }

    this.assertNotLocked(admin);

    const isValidTotp = authenticator.verify({
      token: code,
      secret: admin.totpSecret,
    });

    let usedBackupCode = false;
    if (!isValidTotp) {
      const matchIndex = await this.findMatchingBackupCode(
        admin.backupCodes,
        code,
      );
      if (matchIndex === -1) {
        await this.registerFailedAttempt(admin, 'invalid 2FA code');
        throw new UnauthorizedException('Invalid authentication code');
      }
      usedBackupCode = true;
      const remainingCodes = [...admin.backupCodes];
      remainingCodes.splice(matchIndex, 1);
      await this.prisma.admin.update({
        where: { id: admin.id },
        data: { backupCodes: remainingCodes },
      });
      // Worth noticing: either the admin lost their authenticator, or
      // someone else has a backup code.
      this.logger.warn(
        { adminId: admin.id, backupCodesRemaining: remainingCodes.length },
        'Backup code used to log in',
      );
    }

    await this.prisma.admin.update({
      where: { id: admin.id },
      data: {
        lastLoginAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    const token = await this.signSessionToken(admin.id, admin.email);
    this.logger.log(
      { adminId: admin.id, usedBackupCode },
      'Admin logged in (2FA)',
    );

    return {
      token,
      usedBackupCode,
      admin: { id: admin.id, email: admin.email, fullName: admin.fullName },
    };
  }

  async setupTotp(adminId: string): Promise<TotpSetupResponse> {
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
    });
    if (!admin) {
      throw new UnauthorizedException('Admin no longer exists');
    }

    const secret = authenticator.generateSecret();

    // Not enabled yet — stays password-only until /auth/2fa/confirm proves
    // the admin actually scanned this secret into their authenticator app.
    await this.prisma.admin.update({
      where: { id: adminId },
      data: { totpSecret: secret, totpEnabled: false, backupCodes: [] },
    });
    this.logger.log({ adminId }, '2FA setup started');

    const otpauthUrl = authenticator.keyuri(admin.email, TOTP_ISSUER, secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    return { secret, otpauthUrl, qrCodeDataUrl };
  }

  async confirmTotp(
    adminId: string,
    code: string,
  ): Promise<TotpConfirmResponse> {
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
    });
    if (!admin?.totpSecret) {
      throw new UnauthorizedException('Call /auth/2fa/setup first');
    }

    const isValid = authenticator.verify({
      token: code,
      secret: admin.totpSecret,
    });
    if (!isValid) {
      this.logger.warn({ adminId }, '2FA confirmation failed: invalid code');
      throw new UnauthorizedException('Invalid authentication code');
    }

    const backupCodes = this.generateBackupCodes();
    const hashedCodes = await Promise.all(
      backupCodes.map((backupCode) => bcrypt.hash(backupCode, 10)),
    );

    await this.prisma.admin.update({
      where: { id: adminId },
      data: { totpEnabled: true, backupCodes: hashedCodes },
    });
    this.logger.log({ adminId }, '2FA enabled');

    // Plaintext codes are returned exactly once — only their bcrypt hashes
    // are ever persisted, so this is the admin's only chance to save them.
    return { backupCodes };
  }

  async disableTotp(adminId: string): Promise<SuccessResponse> {
    await this.prisma.admin.update({
      where: { id: adminId },
      data: { totpEnabled: false, totpSecret: null, backupCodes: [] },
    });
    // warn, not log: turning 2FA off is what an attacker with a stolen
    // session would do first.
    this.logger.warn({ adminId }, '2FA disabled');
    return { success: true };
  }

  async getProfile(adminId: string): Promise<AdminProfile> {
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
    });

    if (!admin) {
      throw new UnauthorizedException('Admin no longer exists');
    }

    return {
      id: admin.id,
      email: admin.email,
      fullName: admin.fullName,
      totpEnabled: admin.totpEnabled,
    };
  }

  private signSessionToken(adminId: string, email: string): Promise<string> {
    return this.jwtService.signAsync({ sub: adminId, email });
  }

  private assertNotLocked(admin: {
    id: string;
    lockedUntil: Date | null;
  }): void {
    if (admin.lockedUntil && admin.lockedUntil.getTime() > Date.now()) {
      this.logger.warn(
        { adminId: admin.id, lockedUntil: admin.lockedUntil },
        'Login rejected: account locked',
      );
      throw new HttpException(
        'Account temporarily locked due to too many failed attempts. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async registerFailedAttempt(
    admin: { id: string; failedLoginAttempts: number },
    reason: string,
  ): Promise<void> {
    const attempts = admin.failedLoginAttempts + 1;
    const lockedUntil =
      attempts >= MAX_FAILED_LOGIN_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_DURATION_MS)
        : null;
    await this.prisma.admin.update({
      where: { id: admin.id },
      data: { failedLoginAttempts: attempts, lockedUntil },
    });

    this.logger.warn(
      { adminId: admin.id, failedAttempts: attempts },
      `Login failed: ${reason}`,
    );
    if (lockedUntil) {
      this.logger.error(
        { adminId: admin.id, lockedUntil },
        `Account locked after ${attempts} failed attempts`,
      );
    }
  }

  private generateBackupCodes(): string[] {
    return Array.from({ length: BACKUP_CODE_COUNT }, () =>
      randomBytes(5).toString('hex'),
    );
  }

  private async findMatchingBackupCode(
    hashedCodes: string[],
    candidate: string,
  ): Promise<number> {
    for (const [index, hash] of hashedCodes.entries()) {
      if (await bcrypt.compare(candidate, hash)) {
        return index;
      }
    }
    return -1;
  }
}
