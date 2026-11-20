import { Controller, Get, Header, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/decorators.js';
import { HealthService, type HealthReport } from './health.service.js';

/**
 * Public, minimal liveness/readiness signal for local development and the frontend status card.
 * Exposes only status + database up/down + timestamp (no versions, hosts or error details).
 * Production readiness/diagnostic checks may need separate access controls (human-owned decision).
 */
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async getHealth(@Res({ passthrough: true }) response: Response): Promise<HealthReport> {
    const report = await this.health.check();
    response.status(report.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return report;
  }
}
