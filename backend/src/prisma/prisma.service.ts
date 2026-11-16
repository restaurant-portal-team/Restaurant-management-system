import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { AppConfig } from '../config/env.validation.js';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Runtime Prisma client.
 * Uses ONLY DATABASE_URL (restaurant_app: DML-only role). Migration credentials are never
 * available to this process (see env.validation.ts and prisma.config.ts).
 * Connections are opened lazily, so the API can start and report "database: down"
 * instead of crashing when PostgreSQL is unavailable.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService<AppConfig, true>) {
    const adapter = new PrismaPg({
      connectionString: config.get('DATABASE_URL', { infer: true }),
      application_name: 'restaurant-portal-api',
      max: 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    });
    super({ adapter });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
