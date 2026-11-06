import 'reflect-metadata';
import { Controller, Get, Module, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

@Controller()
class DiagnosticController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      diagnostic: 'minimal-bootstrap-after-empty-app-module',
      timestamp: new Date().toISOString(),
    };
  }
}

@Module({ controllers: [DiagnosticController] })
class DiagnosticModule {}

async function bootstrap() {
  const logger = new Logger('RuntimeIsolation');
  try {
    const app = await NestFactory.create(DiagnosticModule, { abortOnError: false });
    app.setGlobalPrefix('api');
    app.enableCors({ origin: true, methods: 'GET,OPTIONS' });
    await app.listen(process.env.PORT ?? 3000);
    logger.log('Minimal NestJS diagnostic server started');
  } catch (error) {
    logger.error('Minimal NestJS diagnostic startup failed', error instanceof Error ? error.stack : String(error));
    throw error;
  }
}

bootstrap();
