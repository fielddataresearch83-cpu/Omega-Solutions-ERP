import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AccountingService } from './accounting.service.js';
import { CreateAccountDto } from './dto/create-account.dto.js';
import { CreateJournalDto } from './dto/create-journal.dto.js';
import { CreateBankStatementDto, MatchBankStatementLineDto } from './dto/create-bank-statement.dto.js';
import { CreateFixedAssetDto, DisposeFixedAssetDto, RunDepreciationDto } from './dto/fixed-assets.dto.js';
import { CreateBudgetDto, CreateCostCentreDto } from './dto/budgets-cost-centres.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import { RequireModule } from '../subscriptions/require-module.decorator.js';
import { ModuleEntitlementsGuard } from '../subscriptions/module-entitlements.guard.js';
@Controller('accounting')
@RequireModule('accounting')
@UseGuards(JwtAuthGuard,PermissionsGuard, ModuleEntitlementsGuard)
export class AccountingController {
 constructor(private readonly accounting:AccountingService){}
 @Get('accounts') @RequirePermissions('accounting:read') accounts(@Req() req:{user:AuthenticatedUser}){return this.accounting.listAccounts(req.user);}
 @Post('accounts') @RequirePermissions('accounting:write') createAccount(@Req() req:{user:AuthenticatedUser},@Body() dto:CreateAccountDto){return this.accounting.createAccount(req.user,dto);}
 @Get('reports/trial-balance') @RequirePermissions('accounting:read') trialBalance(@Req() req:{user:AuthenticatedUser},@Query('asOfDate') asOfDate?:string){return this.accounting.trialBalance(req.user,asOfDate);}
 @Get('cost-centres') @RequirePermissions('accounting:read') costCentres(@Req() req:{user:AuthenticatedUser}){return this.accounting.listCostCentres(req.user);}
 @Post('cost-centres') @RequirePermissions('accounting:write') createCostCentre(@Req() req:{user:AuthenticatedUser},@Body() dto:CreateCostCentreDto){return this.accounting.createCostCentre(req.user,dto);}
 @Post('budgets') @RequirePermissions('accounting:write') createBudget(@Req() req:{user:AuthenticatedUser},@Body() dto:CreateBudgetDto){return this.accounting.createBudget(req.user,dto);}
 @Post('budgets/:id/approve') @RequirePermissions('accounting:write') approveBudget(@Req() req:{user:AuthenticatedUser},@Param('id',ParseUUIDPipe) id:string){return this.accounting.approveBudget(req.user,id);}
 @Get('reconciliation/payables') @RequirePermissions('accounting:read') payablesReconciliation(@Req() req:{user:AuthenticatedUser}){return this.accounting.payablesReconciliation(req.user);}
 @Get('reconciliation/receivables') @RequirePermissions('accounting:read') receivablesReconciliation(@Req() req:{user:AuthenticatedUser}){return this.accounting.receivablesReconciliation(req.user);}
 @Get('journals') @RequirePermissions('accounting:read') journals(@Req() req:{user:AuthenticatedUser}){return this.accounting.listJournals(req.user);}
 @Get('budgets') @RequirePermissions('accounting:read') budgets(@Req() req:{user:AuthenticatedUser},@Query('fiscalYear') fiscalYear?:string,@Query('periodMonth') periodMonth?:string){
  const year=fiscalYear===undefined?undefined:Number(fiscalYear);
  const month=periodMonth===undefined?undefined:Number(periodMonth);
  if(year!==undefined&&(!Number.isInteger(year)||year<2000||year>2200))throw new BadRequestException('fiscalYear must be a whole year between 2000 and 2200.');
  if(month!==undefined&&(!Number.isInteger(month)||month<1||month>12))throw new BadRequestException('periodMonth must be a whole number between 1 and 12.');
  return this.accounting.budgetVsActual(req.user,year,month);
 }
 @Get('fixed-assets') @RequirePermissions('accounting:read') fixedAssets(@Req() req:{user:AuthenticatedUser}){return this.accounting.listFixedAssets(req.user);}
 @Post('fixed-assets') @RequirePermissions('accounting:write') createFixedAsset(@Req() req:{user:AuthenticatedUser},@Body() dto:CreateFixedAssetDto){return this.accounting.createFixedAsset(req.user,dto);}
 @Get('fixed-assets/:id') @RequirePermissions('accounting:read') fixedAsset(@Req() req:{user:AuthenticatedUser},@Param('id',ParseUUIDPipe) id:string){return this.accounting.getFixedAsset(req.user,id);}
 @Post('fixed-assets/:id/dispose') @RequirePermissions('accounting:write') disposeFixedAsset(@Req() req:{user:AuthenticatedUser},@Param('id',ParseUUIDPipe) id:string,@Body() dto:DisposeFixedAssetDto){return this.accounting.disposeFixedAsset(req.user,id,dto);}
 @Post('fixed-assets/:id/depreciation') @RequirePermissions('accounting:write') depreciateFixedAsset(@Req() req:{user:AuthenticatedUser},@Param('id',ParseUUIDPipe) id:string,@Body() dto:RunDepreciationDto){return this.accounting.depreciateFixedAsset(req.user,id,dto.periodEnd);}
 @Get('bank-statements') @RequirePermissions('accounting:read') bankStatements(@Req() req:{user:AuthenticatedUser}){return this.accounting.listBankStatements(req.user);}
 @Post('bank-statements') @RequirePermissions('accounting:write') importBankStatement(@Req() req:{user:AuthenticatedUser},@Body() dto:CreateBankStatementDto){return this.accounting.importBankStatement(req.user,dto);}
 @Get('bank-statements/:id') @RequirePermissions('accounting:read') bankStatement(@Req() req:{user:AuthenticatedUser},@Param('id',ParseUUIDPipe) id:string){return this.accounting.getBankStatementImport(req.user,id);}
 @Get('bank-statements/:id/lines/:lineId/candidates') @RequirePermissions('accounting:read') bankStatementCandidates(@Req() req:{user:AuthenticatedUser},@Param('id',ParseUUIDPipe) id:string,@Param('lineId',ParseUUIDPipe) lineId:string){return this.accounting.bankStatementCandidates(req.user,id,lineId);}
 @Post('bank-statements/:id/lines/:lineId/unmatch') @RequirePermissions('accounting:write') unmatchBankStatementLine(@Req() req:{user:AuthenticatedUser},@Param('id',ParseUUIDPipe) id:string,@Param('lineId',ParseUUIDPipe) lineId:string){return this.accounting.unmatchBankStatementLine(req.user,id,lineId);}
 @Post('bank-statements/:id/lines/:lineId/match') @RequirePermissions('accounting:write') matchBankStatementLine(@Req() req:{user:AuthenticatedUser},@Param('id',ParseUUIDPipe) id:string,@Param('lineId',ParseUUIDPipe) lineId:string,@Body() dto:MatchBankStatementLineDto){return this.accounting.matchBankStatementLine(req.user,id,lineId,dto.journalEntryId);}
 
 @Post('journals') @RequirePermissions('accounting:write') createJournal(@Req() req:{user:AuthenticatedUser},@Body() dto:CreateJournalDto){return this.accounting.createJournal(req.user,dto);}
 @Post('journals/:id/reverse') @RequirePermissions('accounting:write') reverseJournal(@Req() req:{user:AuthenticatedUser},@Param('id',ParseUUIDPipe) id:string,@Body('reversalDate') reversalDate?:string){return this.accounting.reverseJournal(req.user,id,reversalDate);}
 @Get('journals/:id') @RequirePermissions('accounting:read') journal(@Req() req:{user:AuthenticatedUser},@Param('id',ParseUUIDPipe) id:string){return this.accounting.getJournal(req.user,id);}
 @Get('reports/profit-and-loss') @RequirePermissions('accounting:read') profitAndLoss(@Req() req:{user:AuthenticatedUser},@Query('startDate') startDate:string,@Query('endDate') endDate:string){return this.accounting.profitAndLoss(req.user,startDate,endDate);}
 @Get('reports/balance-sheet') @RequirePermissions('accounting:read') balanceSheet(@Req() req:{user:AuthenticatedUser},@Query('asOfDate') asOfDate:string){return this.accounting.balanceSheet(req.user,asOfDate);}
 @Get('reports/vat') @RequirePermissions('accounting:read') vatSummary(@Req() req:{user:AuthenticatedUser},@Query('startDate') startDate:string,@Query('endDate') endDate:string){return this.accounting.vatSummary(req.user,startDate,endDate);}
 @Get('reports/withholding-tax') @RequirePermissions('accounting:read') withholdingTaxSchedule(@Req() req:{user:AuthenticatedUser},@Query('startDate') startDate:string,@Query('endDate') endDate:string){return this.accounting.withholdingTaxSchedule(req.user,startDate,endDate);}
 @Get('reports/cash-flow') @RequirePermissions('accounting:read') cashFlow(@Req() req:{user:AuthenticatedUser},@Query('startDate') startDate:string,@Query('endDate') endDate:string){return this.accounting.cashFlow(req.user,startDate,endDate);}
}
