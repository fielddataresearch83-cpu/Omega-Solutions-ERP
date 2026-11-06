import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module.js';
import { CommonModule } from './common/common.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { RbacModule } from './rbac/rbac.module.js';
import { MembershipsModule } from './memberships/memberships.module.js';

@Controller()
class HealthController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      diagnostic: 'core-security-modules',
      timestamp: new Date().toISOString(),
    };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    CommonModule,
    AuditModule,
    AuthModule,
    RbacModule,
    MembershipsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
