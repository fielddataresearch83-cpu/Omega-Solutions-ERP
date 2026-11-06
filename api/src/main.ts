import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    abortOnError: false,
  });
  app.setGlobalPrefix('api');
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

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

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
