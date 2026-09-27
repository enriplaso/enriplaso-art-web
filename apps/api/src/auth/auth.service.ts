import { randomBytes } from 'crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import {
  BACKUP_CODE_COUNT,
  PENDING_2FA_PURPOSE,
  PENDING_2FA_TOKEN_EXPIRES_IN,
} from './auth.constants';

const TOTP_ISSUER = 'Art Shop Admin';

export interface AdminSummary {
  id: string;
  email: string;
  fullName: string | null;
}

type LoginResult =
  | { requiresTwoFactor: true; pendingToken: string }
  | { requiresTwoFactor: false; token: string; admin: AdminSummary };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const admin = await this.prisma.admin.findUnique({ where: { email } });

    if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (admin.totpEnabled) {
      const pendingToken = await this.jwtService.signAsync(
        { sub: admin.id, purpose: PENDING_2FA_PURPOSE },
        { expiresIn: PENDING_2FA_TOKEN_EXPIRES_IN },
      );
      return { requiresTwoFactor: true, pendingToken };
    }

    // Only reached when 2FA isn't enabled — otherwise lastLoginAt is
    // updated in verifyTwoFactor, once the login is actually complete.
    await this.prisma.admin.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    const token = await this.signSessionToken(admin.id, admin.email);

    return {
      requiresTwoFactor: false,
      token,
      admin: { id: admin.id, email: admin.email, fullName: admin.fullName },
    };
  }

  async verifyTwoFactor(pendingToken: string, code: string) {
    let payload: { sub: string; purpose?: string };
    try {
      payload = await this.jwtService.verifyAsync<{
        sub: string;
        purpose?: string;
      }>(pendingToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired login attempt');
    }

    if (payload.purpose !== PENDING_2FA_PURPOSE) {
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
        throw new UnauthorizedException('Invalid authentication code');
      }
      usedBackupCode = true;
      const remainingCodes = [...admin.backupCodes];
      remainingCodes.splice(matchIndex, 1);
      await this.prisma.admin.update({
        where: { id: admin.id },
        data: { backupCodes: remainingCodes },
      });
    }

    await this.prisma.admin.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    const token = await this.signSessionToken(admin.id, admin.email);

    return {
      token,
      usedBackupCode,
      admin: { id: admin.id, email: admin.email, fullName: admin.fullName },
    };
  }

  async setupTotp(adminId: string) {
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

    const otpauthUrl = authenticator.keyuri(admin.email, TOTP_ISSUER, secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    return { secret, otpauthUrl, qrCodeDataUrl };
  }

  async confirmTotp(adminId: string, code: string) {
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

    // Plaintext codes are returned exactly once — only their bcrypt hashes
    // are ever persisted, so this is the admin's only chance to save them.
    return { backupCodes };
  }

  async disableTotp(adminId: string) {
    await this.prisma.admin.update({
      where: { id: adminId },
      data: { totpEnabled: false, totpSecret: null, backupCodes: [] },
    });
    return { success: true };
  }

  async getProfile(adminId: string) {
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
