import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Liveness: is this process alive? No dependency checks — a failing
   * dependency (e.g. Postgres down) must not restart this process, since
   * restarting it does nothing to fix an external outage.
   */
  @Get()
  @HealthCheck()
  liveness() {
    return this.health.check([]);
  }

  /**
   * Readiness: should traffic be routed here right now? Checks Postgres —
   * if unreachable, this reports unhealthy (503) so the load balancer stops
   * routing here, while the process itself keeps running and recovers
   * automatically once the database comes back.
   */
  @Get('ready')
  @HealthCheck()
  readiness() {
    return this.health.check([
      () => this.prismaIndicator.pingCheck('database', this.prisma),
    ]);
  }
}
