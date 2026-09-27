import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AdminAuthGuard } from './admin-auth.guard';

// Kept as a named reference (not inlined) so the exact same configured
// registration is both imported here and re-exported below — needed
// because @UseGuards(AdminAuthGuard) resolves AdminAuthGuard from the
// *consuming* module's injector (e.g. ProductsModule), not AuthModule's,
// so that module needs JwtService reachable too, not just the guard class.
const jwtModule = JwtModule.registerAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    // Fails fast at startup rather than at the first login attempt if
    // JWT_SECRET was never set — a missing secret here must never
    // silently fall back to something guessable.
    secret: config.getOrThrow<string>('JWT_SECRET'),
    signOptions: { expiresIn: '7d' },
  }),
});

@Module({
  imports: [jwtModule],
  controllers: [AuthController],
  providers: [AuthService, AdminAuthGuard],
  exports: [AdminAuthGuard, jwtModule],
})
export class AuthModule {}
