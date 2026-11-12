import { Module } from '@nestjs/common';
import { RedisCacheModule } from './cache/redis-cache.module.js';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
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
import { AccountingModule } from './accounting/accounting.module.js';
import { ManufacturingModule } from './manufacturing/manufacturing.module.js';
import { EmployeesModule } from './employees/employees.module.js';
import { ExpensesModule } from './expenses/expenses.module.js';
import { PayrollModule } from './payroll/payroll.module.js';
import { WorkforceModule } from './workforce/workforce.module.js';
import { PosModule } from './pos/pos.module.js';
import { RequisitionsModule } from './requisitions/requisitions.module.js';
import { ContractsModule } from './contracts/contracts.module.js';
import { ApprovalsModule } from './approvals/approvals.module.js';
import { UsersRolesModule } from './users-roles/users-roles.module.js';
import { CreditNotesModule } from './credit-notes/credit-notes.module.js';
import { SearchModule } from './search/search.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { SubscriptionsModule } from './subscriptions/subscriptions.module.js';
import { EntitlementsModule } from './subscriptions/entitlements.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TenantDatabaseContextInterceptor } from './database/tenant-database-context.interceptor.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }), RedisCacheModule, DatabaseModule, CommonModule, AuditModule,
    AuthModule, RbacModule, MembershipsModule, CompaniesModule, BranchesModule,
    CustomersModule, SuppliersModule, ProductsModule, InvoicesModule, QuotationsModule,
    SalesOrdersModule, CrmModule, InventoryModule, PurchaseOrdersModule, SupplierBillsModule,
    AccountingModule, ManufacturingModule, EmployeesModule, ExpensesModule, PayrollModule,
    WorkforceModule, PosModule, RequisitionsModule, ContractsModule, ApprovalsModule, UsersRolesModule,
    CreditNotesModule, SearchModule, NotificationsModule, SubscriptionsModule, EntitlementsModule, DashboardModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_INTERCEPTOR, useClass: TenantDatabaseContextInterceptor }],
})
export class AppModule {}
