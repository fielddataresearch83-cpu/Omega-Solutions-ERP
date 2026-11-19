import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ManufacturingService } from './manufacturing.service.js';
import { CreateBomDto, CreateProductionOrderDto, CreateProductionCostDto, CreateManufacturingQualityEventDto } from './dto/manufacturing.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import { RequireModule } from '../subscriptions/require-module.decorator.js';
import { ModuleEntitlementsGuard } from '../subscriptions/module-entitlements.guard.js';

@Controller('manufacturing')
@RequireModule('manufacturing')
@UseGuards(JwtAuthGuard,PermissionsGuard, ModuleEntitlementsGuard)
export class ManufacturingController {
 constructor(private readonly manufacturing:ManufacturingService){}
 @Get('boms') @RequirePermissions('manufacturing:read') listBoms(@Req() req:{user:AuthenticatedUser}){return this.manufacturing.listBoms(req.user);}
 @Get('boms/:id') @RequirePermissions('manufacturing:read') getBom(@Req() req:{user:AuthenticatedUser},@Param('id',ParseUUIDPipe) id:string){return this.manufacturing.getBom(req.user,id);}
 @Post('boms') @RequirePermissions('manufacturing:write') createBom(@Req() req:{user:AuthenticatedUser},@Body() dto:CreateBomDto){return this.manufacturing.createBom(req.user,dto);}
 @Get('orders') @RequirePermissions('manufacturing:read') listOrders(@Req() req:{user:AuthenticatedUser}){return this.manufacturing.listOrders(req.user);}
 @Get('orders/:id/costs') @RequirePermissions('manufacturing:read') listOrderCosts(@Req() req:{user:AuthenticatedUser},@Param('id',ParseUUIDPipe) id:string){return this.manufacturing.listOrderCosts(req.user,id);}
 @Post('orders/:id/costs') @RequirePermissions('manufacturing:write') addOrderCost(@Req() req:{user:AuthenticatedUser},@Param('id',ParseUUIDPipe) id:string,@Body() dto:CreateProductionCostDto){return this.manufacturing.addOrderCost(req.user,id,dto);}
 @Post('orders/:id/start') @RequirePermissions('manufacturing:write') startOrder(@Req() req:{user:AuthenticatedUser},@Param('id',ParseUUIDPipe) id:string){return this.manufacturing.startOrder(req.user,id);}
 @Post('orders/:id/cancel') @RequirePermissions('manufacturing:write') cancelOrder(@Req() req:{user:AuthenticatedUser},@Param('id',ParseUUIDPipe) id:string){return this.manufacturing.cancelOrder(req.user,id);}
 @Post('orders/:id/complete') @RequirePermissions('manufacturing:write') completeOrder(@Req() req:{user:AuthenticatedUser},@Param('id',ParseUUIDPipe) id:string){return this.manufacturing.completeOrder(req.user,id);}
 @Post('orders') @RequirePermissions('manufacturing:write') createOrder(@Req() req:{user:AuthenticatedUser},@Body() dto:CreateProductionOrderDto){return this.manufacturing.createOrder(req.user,dto);}

 @Get('quality-events') @RequirePermissions('manufacturing:read') listQualityEvents(@Req() req:{user:AuthenticatedUser}){return this.manufacturing.listQualityEvents(req.user);}
 @Post('quality-events') @RequirePermissions('manufacturing:write') createQualityEvent(@Req() req:{user:AuthenticatedUser},@Body() dto:CreateManufacturingQualityEventDto){return this.manufacturing.createQualityEvent(req.user,dto);}
 @Post('quality-events/:id/approve') @RequirePermissions('manufacturing:write') approveQualityEvent(@Req() req:{user:AuthenticatedUser},@Param('id',ParseUUIDPipe) id:string,@Body('inspectionResult') inspectionResult?:string){return this.manufacturing.approveQualityEvent(req.user,id,inspectionResult);}
}
