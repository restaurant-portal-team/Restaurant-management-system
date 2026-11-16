import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { API_PREFIX, configureApp } from './app.setup.js';
import type { AppConfig } from './config/env.validation.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);

  const config = app.get<ConfigService<AppConfig, true>>(ConfigService);
  const host = config.get('HOST', { infer: true });
  const port = config.get('PORT', { infer: true });

  await app.listen(port, host);
  Logger.log(`API listening on http://${host}:${port}/${API_PREFIX}`, 'Bootstrap');
}

await bootstrap();
