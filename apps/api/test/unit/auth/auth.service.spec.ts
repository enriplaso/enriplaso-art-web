import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { HttpException, UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { AuthService } from '../../../src/auth/auth.service';
import {
  MAX_FAILED_LOGIN_ATTEMPTS,
  PENDING_2FA_PURPOSE,
} from '../../../src/auth/auth.constants';

vi.mock('bcryptjs', () => ({
  compare: vi.fn(),
  hash: vi.fn(),
}));

vi.mock('otplib', () => ({
  authenticator: {
    generateSecret: vi.fn(),
    keyuri: vi.fn(),
    verify: vi.fn(),
  },
}));

vi.mock('qrcode', () => ({
  toDataURL: vi.fn(),
}));

type MockPrisma = {
  admin: {
    findUnique: Mock;
    update: Mock;
  };
};

type MockJwtService = {
  signAsync: Mock;
  verifyAsync: Mock;
};

function createMockPrisma(): MockPrisma {
  return {
    admin: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };
}

const ADMIN = {
  id: 'admin-1',
  email: 'admin@example.com',
  passwordHash: 'hashed-password',
  fullName: 'Admin Person',
  createdAt: new Date(),
  lastLoginAt: null,
  totpSecret: null as string | null,
  totpEnabled: false,
  backupCodes: [] as string[],
  failedLoginAttempts: 0,
  lockedUntil: null as Date | null,
};

describe('AuthService', () => {
  let service: AuthService;
  let prisma: MockPrisma;
  let jwtService: MockJwtService;

  beforeEach(() => {
    prisma = createMockPrisma();
    jwtService = { signAsync: vi.fn(), verifyAsync: vi.fn() };
    vi.mocked(bcrypt.compare).mockReset();
    vi.mocked(bcrypt.hash).mockReset();
    vi.mocked(authenticator.generateSecret).mockReset();
    vi.mocked(authenticator.keyuri).mockReset();
    vi.mocked(authenticator.verify).mockReset();
    vi.mocked(QRCode.toDataURL).mockReset();
    service = new AuthService(
      prisma as unknown as PrismaService,
      jwtService as unknown as JwtService,
    );
  });

  describe('login', () => {
    it('throws UnauthorizedException when the admin does not exist', async () => {
      prisma.admin.findUnique.mockResolvedValue(null);

      await expect(service.login('missing@example.com', 'pw')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException and records a failed attempt when the password does not match', async () => {
      prisma.admin.findUnique.mockResolvedValue(ADMIN);
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      await expect(service.login(ADMIN.email, 'wrong')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.admin.update).toHaveBeenCalledWith({
        where: { id: ADMIN.id },
        data: { failedLoginAttempts: 1, lockedUntil: null },
      });
    });

    it('locks the account once MAX_FAILED_LOGIN_ATTEMPTS is reached', async () => {
      prisma.admin.findUnique.mockResolvedValue({
        ...ADMIN,
        failedLoginAttempts: MAX_FAILED_LOGIN_ATTEMPTS - 1,
      });
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      await expect(service.login(ADMIN.email, 'wrong')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.admin.update).toHaveBeenCalledWith({
        where: { id: ADMIN.id },
        data: {
          failedLoginAttempts: MAX_FAILED_LOGIN_ATTEMPTS,
          lockedUntil: expect.any(Date),
        },
      });
    });

    it('rejects immediately (without checking the password) while locked', async () => {
      prisma.admin.findUnique.mockResolvedValue({
        ...ADMIN,
        lockedUntil: new Date(Date.now() + 60_000),
      });

      await expect(
        service.login(ADMIN.email, 'correct-horse-battery-staple'),
      ).rejects.toThrow(HttpException);
      expect(bcrypt.compare).not.toHaveBeenCalled();
      expect(prisma.admin.update).not.toHaveBeenCalled();
    });

    it('allows login again once the lock has expired', async () => {
      prisma.admin.findUnique.mockResolvedValue({
        ...ADMIN,
        lockedUntil: new Date(Date.now() - 1000), // expired
      });
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      jwtService.signAsync.mockResolvedValue('signed.jwt.token');

      const result = await service.login(ADMIN.email, 'correct-password');

      if (result.requiresTwoFactor) {
        throw new Error('expected requiresTwoFactor to be false');
      }
      expect(result.token).toBe('signed.jwt.token');
    });

    it('updates lastLoginAt and returns a signed token when 2FA is off', async () => {
      prisma.admin.findUnique.mockResolvedValue(ADMIN);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      jwtService.signAsync.mockResolvedValue('signed.jwt.token');

      const result = await service.login(ADMIN.email, 'correct-password');

      expect(prisma.admin.update).toHaveBeenCalledWith({
        where: { id: ADMIN.id },
        data: {
          lastLoginAt: expect.any(Date),
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
      expect(jwtService.signAsync).toHaveBeenCalledWith({
        sub: ADMIN.id,
        email: ADMIN.email,
      });
      if (result.requiresTwoFactor) {
        throw new Error('expected requiresTwoFactor to be false');
      }
      expect(result.token).toBe('signed.jwt.token');
      expect(result.admin).toEqual({
        id: ADMIN.id,
        email: ADMIN.email,
        fullName: ADMIN.fullName,
      });
    });

    it('returns a pending token instead of a session when 2FA is on', async () => {
      prisma.admin.findUnique.mockResolvedValue({
        ...ADMIN,
        totpEnabled: true,
        totpSecret: 'SECRET',
      });
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      jwtService.signAsync.mockResolvedValue('pending.jwt.token');

      const result = await service.login(ADMIN.email, 'correct-password');

      expect(prisma.admin.update).not.toHaveBeenCalled();
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        { sub: ADMIN.id, purpose: PENDING_2FA_PURPOSE },
        expect.objectContaining({ expiresIn: expect.any(String) }),
      );
      if (!result.requiresTwoFactor) {
        throw new Error('expected requiresTwoFactor to be true');
      }
      expect(result.pendingToken).toBe('pending.jwt.token');
    });
  });

  describe('verifyTwoFactor', () => {
    const TWO_FA_ADMIN = {
      ...ADMIN,
      totpEnabled: true,
      totpSecret: 'SECRET',
      backupCodes: ['hashed-backup-1', 'hashed-backup-2'],
    };

    it('throws when the pending token is invalid or expired', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('expired'));

      await expect(
        service.verifyTwoFactor('bad-token', '123456'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws when the token is not actually a pending-2FA token', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: ADMIN.id });

      await expect(
        service.verifyTwoFactor('not-pending', '123456'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('accepts a valid TOTP code and issues a full session', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: TWO_FA_ADMIN.id,
        purpose: PENDING_2FA_PURPOSE,
      });
      prisma.admin.findUnique.mockResolvedValue(TWO_FA_ADMIN);
      vi.mocked(authenticator.verify).mockReturnValue(true);
      jwtService.signAsync.mockResolvedValue('full-session-token');

      const result = await service.verifyTwoFactor('pending-token', '123456');

      expect(result.usedBackupCode).toBe(false);
      expect(result.token).toBe('full-session-token');
      expect(prisma.admin.update).toHaveBeenCalledWith({
        where: { id: TWO_FA_ADMIN.id },
        data: {
          lastLoginAt: expect.any(Date),
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
    });

    it('rejects immediately while locked, without checking the code', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: TWO_FA_ADMIN.id,
        purpose: PENDING_2FA_PURPOSE,
      });
      prisma.admin.findUnique.mockResolvedValue({
        ...TWO_FA_ADMIN,
        lockedUntil: new Date(Date.now() + 60_000),
      });

      await expect(
        service.verifyTwoFactor('pending-token', '123456'),
      ).rejects.toThrow(HttpException);
      expect(authenticator.verify).not.toHaveBeenCalled();
    });

    it('records a failed attempt when the code is wrong', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: TWO_FA_ADMIN.id,
        purpose: PENDING_2FA_PURPOSE,
      });
      prisma.admin.findUnique.mockResolvedValue(TWO_FA_ADMIN);
      vi.mocked(authenticator.verify).mockReturnValue(false);
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      await expect(
        service.verifyTwoFactor('pending-token', 'wrong'),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.admin.update).toHaveBeenCalledWith({
        where: { id: TWO_FA_ADMIN.id },
        data: { failedLoginAttempts: 1, lockedUntil: null },
      });
    });

    it('falls back to a backup code and consumes it on use', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: TWO_FA_ADMIN.id,
        purpose: PENDING_2FA_PURPOSE,
      });
      prisma.admin.findUnique.mockResolvedValue(TWO_FA_ADMIN);
      vi.mocked(authenticator.verify).mockReturnValue(false);
      vi.mocked(bcrypt.compare).mockImplementation(
        (candidate, hash) =>
          Promise.resolve(hash === 'hashed-backup-2') as never,
      );
      jwtService.signAsync.mockResolvedValue('full-session-token');

      const result = await service.verifyTwoFactor(
        'pending-token',
        'a-backup-code',
      );

      expect(result.usedBackupCode).toBe(true);
      expect(prisma.admin.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { backupCodes: ['hashed-backup-1'] },
        }),
      );
    });

    it('throws when neither the TOTP code nor any backup code matches', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: TWO_FA_ADMIN.id,
        purpose: PENDING_2FA_PURPOSE,
      });
      prisma.admin.findUnique.mockResolvedValue(TWO_FA_ADMIN);
      vi.mocked(authenticator.verify).mockReturnValue(false);
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      await expect(
        service.verifyTwoFactor('pending-token', 'wrong'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('setupTotp', () => {
    it('generates and stores a secret, disabled until confirmed', async () => {
      prisma.admin.findUnique.mockResolvedValue(ADMIN);
      vi.mocked(authenticator.generateSecret).mockReturnValue('NEWSECRET');
      vi.mocked(authenticator.keyuri).mockReturnValue('otpauth://totp/...');
      // QRCode.toDataURL is overloaded (callback vs Promise variants);
      // cast to Mock directly rather than fighting overload resolution.
      (QRCode.toDataURL as Mock).mockResolvedValue('data:image/png;base64,...');

      const result = await service.setupTotp(ADMIN.id);

      expect(prisma.admin.update).toHaveBeenCalledWith({
        where: { id: ADMIN.id },
        data: { totpSecret: 'NEWSECRET', totpEnabled: false, backupCodes: [] },
      });
      expect(result.secret).toBe('NEWSECRET');
      expect(result.qrCodeDataUrl).toBe('data:image/png;base64,...');
    });
  });

  describe('confirmTotp', () => {
    it('throws if setup was never called', async () => {
      prisma.admin.findUnique.mockResolvedValue({
        ...ADMIN,
        totpSecret: null,
      });

      await expect(service.confirmTotp(ADMIN.id, '123456')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws on an invalid code', async () => {
      prisma.admin.findUnique.mockResolvedValue({
        ...ADMIN,
        totpSecret: 'SECRET',
      });
      vi.mocked(authenticator.verify).mockReturnValue(false);

      await expect(service.confirmTotp(ADMIN.id, '000000')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('enables 2FA and returns plaintext backup codes on success', async () => {
      prisma.admin.findUnique.mockResolvedValue({
        ...ADMIN,
        totpSecret: 'SECRET',
      });
      vi.mocked(authenticator.verify).mockReturnValue(true);
      vi.mocked(bcrypt.hash).mockResolvedValue('hashed' as never);

      const result = await service.confirmTotp(ADMIN.id, '123456');

      expect(result.backupCodes).toHaveLength(10);
      expect(prisma.admin.update).toHaveBeenCalledWith({
        where: { id: ADMIN.id },
        data: {
          totpEnabled: true,
          backupCodes: expect.arrayContaining(['hashed']),
        },
      });
    });
  });

  describe('disableTotp', () => {
    it('clears the secret, flag, and backup codes', async () => {
      await service.disableTotp(ADMIN.id);

      expect(prisma.admin.update).toHaveBeenCalledWith({
        where: { id: ADMIN.id },
        data: { totpEnabled: false, totpSecret: null, backupCodes: [] },
      });
    });
  });

  describe('getProfile', () => {
    it('throws UnauthorizedException if the admin no longer exists', async () => {
      prisma.admin.findUnique.mockResolvedValue(null);

      await expect(service.getProfile('missing-id')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('returns the admin profile including totpEnabled', async () => {
      prisma.admin.findUnique.mockResolvedValue(ADMIN);

      const result = await service.getProfile(ADMIN.id);

      expect(result).toEqual({
        id: ADMIN.id,
        email: ADMIN.email,
        fullName: ADMIN.fullName,
        totpEnabled: ADMIN.totpEnabled,
      });
    });
  });
});
