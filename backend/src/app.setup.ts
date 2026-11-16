import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import type { AppConfig } from './config/env.validation.js';

export const API_PREFIX = 'api/v1';

/**
 * Shared HTTP hardening applied by main.ts and by e2e tests, so tests exercise the real setup.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get<ConfigService<AppConfig, true>>(ConfigService);
  const allowedOrigins = new Set(config.get('CORS_ORIGINS', { infer: true }));
  const isProduction = config.get('NODE_ENV', { infer: true }) === 'production';

  const expressApp = app as NestExpressApplication;
  expressApp.disable('x-powered-by');
  expressApp.set('trust proxy', false);

  app.setGlobalPrefix(API_PREFIX);

  app.use(helmet());

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Requests without an Origin header (curl, server-to-server) are not browser CORS requests.
      // Disallowed origins receive no CORS headers, so browsers block them.
      callback(null, origin === undefined || allowedOrigins.has(origin));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Accept', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    credentials: true,
    maxAge: 600,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      disableErrorMessages: isProduction,
    }),
  );

  app.enableShutdownHooks();
}
