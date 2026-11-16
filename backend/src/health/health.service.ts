import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface HealthReport {
  status: 'ok' | 'error';
  database: 'up' | 'down';
  timestamp: string;
}

const DB_CHECK_TIMEOUT_MS = 3_000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<HealthReport> {
    const databaseUp = await this.isDatabaseUp();
    return {
      status: databaseUp ? 'ok' : 'error',
      database: databaseUp ? 'up' : 'down',
      timestamp: new Date().toISOString(),
    };
  }

  private async isDatabaseUp(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error('Database health check timed out'));
      }, DB_CHECK_TIMEOUT_MS);
    });

    try {
      // Parameterised tagged-template query; no user input involved.
      await Promise.race([this.prisma.$queryRaw`SELECT 1`, timeout]);
      return true;
    } catch (error: unknown) {
      // Log only a safe classification, never connection strings or driver messages.
      this.logger.warn(`Database health check failed (${classify(error)})`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}

function classify(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error;
    if (typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code)) return code;
  }
  return error instanceof Error ? error.name : 'unknown';
}
