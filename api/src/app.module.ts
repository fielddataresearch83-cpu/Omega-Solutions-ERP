import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module.js';
import { CommonModule } from './common/common.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { RbacModule } from './rbac/rbac.module.js';
import { MembershipsModule } from './memberships/memberships.module.js';
import { CompaniesModule } from './companies/companies.module.js';
import { BranchesModule } from './branches/branches.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { SuppliersModule } from './suppliers/suppliers.module.js';
import { ProductsModule } from './products/products.module.js';
import { InvoicesModule } from './invoices/invoices.module.js';
import { QuotationsModule } from './quotations/quotations.module.js';
import { SalesOrdersModule } from './sales-orders/sales-orders.module.js';
import { CrmModule } from './crm/crm.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module.js';
import { SupplierBillsModule } from './supplier-bills/supplier-bills.module.js';

@Controller()
class HealthController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      diagnostic: 'sales-inventory-modules',
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
    CompaniesModule,
    BranchesModule,
    CustomersModule,
    SuppliersModule,
    ProductsModule,
    InvoicesModule,
    QuotationsModule,
    SalesOrdersModule,
    CrmModule,
    InventoryModule,
    PurchaseOrdersModule,
    SupplierBillsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
