import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.setGlobalPrefix('api');

  // Trust exactly the nearest proxy hop. The rate limiter never trusts a
  // caller-supplied forwarding header directly.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // Allow explicitly configured frontend origins and this project's Vercel
  // deployment URLs. Do not allow arbitrary *.vercel.app origins.
  const configuredOrigins = [
    ...(process.env.CORS_ORIGINS || '').split(','),
    ...(process.env.CORS_ORIGIN || '').split(','),
  ].map((origin) => origin.trim()).filter(Boolean);
  const corsOrigins = new Set(
    configuredOrigins.length ? configuredOrigins : ['http://localhost:5173'],
  );
  const isTrustedVercelOrigin = (origin: string) =>
    /^https:\/\/omega-solutions-erp(?:-[a-z0-9-]+)?\.vercel\.app$/.test(origin);

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin || corsOrigins.has(origin) || isTrustedVercelOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin not allowed by CORS'));
    },
    methods: 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`Omega API listening on port ${port}`);
}

await bootstrap();
