import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { Pool } from 'pg';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  try {
    logger.log('Starting Omega API bootstrap');
    const app = await NestFactory.create(AppModule, { rawBody: true, abortOnError: false });
    app.setGlobalPrefix('api');
    app.getHttpAdapter().getInstance().get('/api/diag', async (_req: unknown, res: { status: (code: number) => { json: (value: unknown) => void }; json: (value: unknown) => void }) => {
      const connectionString = process.env.DATABASE_URL;
      if (!connectionString) return res.status(503).json({ status: 'missing', variable: 'DATABASE_URL' });
      let host = 'unparseable';
      try { host = new URL(connectionString).hostname; } catch {}
      const pool = new Pool({ connectionString, connectionTimeoutMillis: 8000, ssl: connectionString.includes('neon.tech') ? { rejectUnauthorized: true } : undefined });
      try {
        await pool.query('SELECT 1');
        return res.json({ status: 'ok', databaseUrlPresent: true, host, query: 'SELECT 1 succeeded' });
      } catch (error) {
        const e = error as { name?: string; code?: string; message?: string };
        return res.status(503).json({ status: 'database_error', databaseUrlPresent: true, host, errorName: e.name, errorCode: e.code, errorMessage: e.message?.slice(0, 300) });
      } finally { await pool.end(); }
    });
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
    const configuredOrigins = [
      ...(process.env.CORS_ORIGINS || '').split(','),
      ...(process.env.CORS_ORIGIN || '').split(','),
    ].map((origin) => origin.trim()).filter(Boolean);
    const corsOrigins = new Set(configuredOrigins.length ? configuredOrigins : ['http://localhost:5173']);
    const isTrustedVercelOrigin = (origin: string) =>
      /^https:\/\/omega-solutions-erp(?:-[a-z0-9-]+)?\.vercel\.app$/.test(origin);
    app.enableCors({
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        if (!origin || corsOrigins.has(origin) || isTrustedVercelOrigin(origin)) callback(null, true);
        else callback(new Error('Origin not allowed by CORS'));
      },
      methods: 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      credentials: true,
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.enableShutdownHooks();
    const port = process.env.PORT ?? 3000;
    await app.listen(port);
    logger.log(`Omega API listening on port ${port}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    logger.error(`Omega API bootstrap failed: ${message}`, stack);
    throw error;
  }
}
await bootstrap();
