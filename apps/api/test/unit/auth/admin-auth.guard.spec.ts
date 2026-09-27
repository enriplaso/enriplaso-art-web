import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import { AdminAuthGuard } from '../../../src/auth/admin-auth.guard';
import { ACCESS_TOKEN_COOKIE } from '../../../src/auth/auth.constants';

type MockJwtService = {
  verifyAsync: Mock;
};

interface FakeRequest {
  cookies: Record<string, string>;
  admin?: { sub: string; email: string };
}

function createExecutionContext(cookies: Record<string, string> = {}) {
  const request: FakeRequest = { cookies };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('AdminAuthGuard', () => {
  let jwtService: MockJwtService;
  let guard: AdminAuthGuard;

  beforeEach(() => {
    jwtService = { verifyAsync: vi.fn() };
    guard = new AdminAuthGuard(jwtService as unknown as JwtService);
  });

  it('throws UnauthorizedException when no cookie is present', async () => {
    const { context } = createExecutionContext();

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException when the token is invalid', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('bad token'));
    const { context } = createExecutionContext({
      [ACCESS_TOKEN_COOKIE]: 'bad',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('allows the request through and attaches the admin payload when the token is valid', async () => {
    const payload = { sub: 'admin-1', email: 'admin@example.com' };
    jwtService.verifyAsync.mockResolvedValue(payload);
    const { context, request } = createExecutionContext({
      [ACCESS_TOKEN_COOKIE]: 'good-token',
    });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(request.admin).toEqual(payload);
  });
});
