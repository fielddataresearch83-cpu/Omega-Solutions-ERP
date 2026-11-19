import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { UserPreferencesController } from './user-preferences.controller.js';
import { UserPreferencesService } from './user-preferences.service.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [UserPreferencesController],
  providers: [UserPreferencesService],
})
export class UserPreferencesModule {}
