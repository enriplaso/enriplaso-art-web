import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { ACCESS_TOKEN_COOKIE, PENDING_2FA_PURPOSE } from './auth.constants';

interface SessionPayload {
  sub: string;
  email?: string;
  purpose?: string;
}

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.cookies?.[ACCESS_TOKEN_COOKIE] as string | undefined;

    if (!token) {
      throw new UnauthorizedException('Not authenticated');
    }

    let payload: SessionPayload;
    try {
      payload = await this.jwtService.verifyAsync<SessionPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }

    // Defense-in-depth: a pending-2FA token must never grant a full
    // session, even if it somehow ends up under the access-token cookie
    // name rather than its own — the separate cookie name alone is not
    // treated as the security boundary.
    if (payload.purpose === PENDING_2FA_PURPOSE || !payload.email) {
      throw new UnauthorizedException('Two-factor verification required');
    }

    request.admin = { sub: payload.sub, email: payload.email };
    return true;
  }
}
