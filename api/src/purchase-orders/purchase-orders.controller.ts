import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service.js';
import { CreatePurchaseOrderDto, ReceivePurchaseOrderDto, UpdatePurchaseOrderStatusDto } from './dto/purchase-order.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import { RequireModule } from '../subscriptions/require-module.decorator.js';
import { ModuleEntitlementsGuard } from '../subscriptions/module-entitlements.guard.js';
@Controller('purchase-orders')
@RequireModule('procurement')
@UseGuards(JwtAuthGuard,PermissionsGuard, ModuleEntitlementsGuard)
export class PurchaseOrdersController {
 constructor(private readonly orders:PurchaseOrdersService){}
 @Get() @RequirePermissions('purchases:read') list(@Req() req:{user:AuthenticatedUser}){return this.orders.list(req.user);}
 @Get(':id/receipts') @RequirePermissions('purchases:read') listReceipts(@Req() req:{user:AuthenticatedUser},@Param('id',ParseUUIDPipe) id:string){return this.orders.listReceipts(req.user,id);}
 @Get(':id') @RequirePermissions('purchases:read') getById(@Req() req:{user:AuthenticatedUser},@Param('id',ParseUUIDPipe) id:string){return this.orders.getById(req.user,id);}
 @Post() @RequirePermissions('purchases:write') create(@Req() req:{user:AuthenticatedUser},@Body() dto:CreatePurchaseOrderDto){return this.orders.create(req.user,dto);}
 @Patch(':id/status') @RequirePermissions('purchases:write') updateStatus(@Req() req:{user:AuthenticatedUser},@Param('id',ParseUUIDPipe) id:string,@Body() dto:UpdatePurchaseOrderStatusDto){return this.orders.updateStatus(req.user,id,dto);}
 @Post(':id/receive') @RequirePermissions('purchases:write') receive(@Req() req:{user:AuthenticatedUser},@Param('id',ParseUUIDPipe) id:string,@Body() dto:ReceivePurchaseOrderDto){return this.orders.receive(req.user,id,dto);}
}
