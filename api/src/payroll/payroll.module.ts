import { Module } from '@nestjs/common';
import { PayrollController } from './payroll.controller.js';
import { PayrollRemittancesController } from './payroll-remittances.controller.js';
import { PayrollService } from './payroll.service.js';
import { PayrollRemittancesService } from './payroll-remittances.service.js';
import { DatabaseModule } from '../database/database.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { MembershipsModule } from '../memberships/memberships.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { RbacModule } from '../rbac/rbac.module.js';

@Module({
 imports:[DatabaseModule,MembershipsModule,AuditModule,AuthModule,RbacModule],
 controllers:[PayrollController,PayrollRemittancesController],
 providers:[PayrollService,PayrollRemittancesService],
})
export class PayrollModule {}
