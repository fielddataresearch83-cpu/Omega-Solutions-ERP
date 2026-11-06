import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module.js';

@Controller()
class HealthController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      diagnostic: 'config-and-database-module',
      timestamp: new Date().toISOString(),
    };
  }
}

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DatabaseModule],
  controllers: [HealthController],
})
export class AppModule {}
