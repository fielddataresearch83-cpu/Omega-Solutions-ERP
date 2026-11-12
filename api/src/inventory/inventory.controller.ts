import {
  Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { InventoryService } from './inventory.service.js';
import { AdjustStockDto, CountStocktakeLineDto, CreateStockMovementDto, CreateStocktakeDto, CreateWarehouseDto, TransferStockDto, UpdateWarehouseDto } from './dto/inventory.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import { RequireModule } from '../subscriptions/require-module.decorator.js';
import { ModuleEntitlementsGuard } from '../subscriptions/module-entitlements.guard.js';

@Controller('inventory')
@RequireModule('inventory')
@UseGuards(JwtAuthGuard, PermissionsGuard, ModuleEntitlementsGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('summary')
  @RequirePermissions('inventory:read')
  summary(@Req() req: { user: AuthenticatedUser }) {
    return this.inventory.summary(req.user);
  }

  @Get('reconciliation')
  @RequirePermissions('inventory:read')
  reconciliation(@Req() req: { user: AuthenticatedUser }) {
    return this.inventory.reconciliation(req.user);
  }

  @Get('warehouses')
  @RequirePermissions('inventory:read')
  warehouses(@Req() req: { user: AuthenticatedUser }) {
    return this.inventory.listWarehouses(req.user);
  }

  @Post('warehouses')
  @RequirePermissions('inventory:write')
  createWarehouse(@Req() req: { user: AuthenticatedUser }, @Body() dto: CreateWarehouseDto) {
    return this.inventory.createWarehouse(req.user, dto);
  }

  @Patch('warehouses/:warehouseId')
  @RequirePermissions('inventory:write')
  updateWarehouse(
    @Req() req: { user: AuthenticatedUser },
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Body() dto: UpdateWarehouseDto,
  ) {
    return this.inventory.updateWarehouse(req.user, warehouseId, dto);
  }

  @Get('stock')
  @RequirePermissions('inventory:read')
  stock(@Req() req: { user: AuthenticatedUser }, @Query('warehouseId') warehouseId?: string, @Query('search') search?: string) {
    return this.inventory.listStock(req.user, warehouseId, search);
  }

  @Get('movements')
  @RequirePermissions('inventory:read')
  movements(@Req() req: { user: AuthenticatedUser }, @Query('limit') limit?: string) {
    return this.inventory.listMovements(req.user, limit);
  }

  @Get('stocktakes')
  @RequirePermissions('inventory:read')
  stocktakes(@Req() req: { user: AuthenticatedUser }) { return this.inventory.listStocktakes(req.user); }

  @Post('stocktakes')
  @RequirePermissions('inventory:write')
  createStocktake(@Req() req: { user: AuthenticatedUser }, @Body() dto: CreateStocktakeDto) { return this.inventory.createStocktake(req.user, dto); }

  @Get('stocktakes/:stocktakeId')
  @RequirePermissions('inventory:read')
  stocktake(@Req() req: { user: AuthenticatedUser }, @Param('stocktakeId', ParseUUIDPipe) id: string) { return this.inventory.getStocktake(req.user, id); }

  @Patch('stocktakes/:stocktakeId/lines/:lineId')
  @RequirePermissions('inventory:write')
  countStocktakeLine(@Req() req: { user: AuthenticatedUser }, @Param('stocktakeId', ParseUUIDPipe) id: string, @Param('lineId', ParseUUIDPipe) lineId: string, @Body() dto: CountStocktakeLineDto) { return this.inventory.countStocktakeLine(req.user, id, lineId, dto); }

  @Post('stocktakes/:stocktakeId/post')
  @RequirePermissions('inventory:write')
  postStocktake(@Req() req: { user: AuthenticatedUser }, @Param('stocktakeId', ParseUUIDPipe) id: string) { return this.inventory.postStocktake(req.user, id); }

  @Post('stocktakes/:stocktakeId/cancel')
  @RequirePermissions('inventory:write')
  cancelStocktake(@Req() req: { user: AuthenticatedUser }, @Param('stocktakeId', ParseUUIDPipe) id: string) { return this.inventory.cancelStocktake(req.user, id); }

  @Post('receipts')
  @RequirePermissions('inventory:write')
  receive(@Req() req: { user: AuthenticatedUser }, @Body() dto: CreateStockMovementDto) {
    return this.inventory.receive(req.user, dto);
  }

  @Post('issues')
  @RequirePermissions('inventory:write')
  issue(@Req() req: { user: AuthenticatedUser }, @Body() dto: CreateStockMovementDto) {
    return this.inventory.issue(req.user, dto);
  }

  @Post('adjustments')
  @RequirePermissions('inventory:write')
  adjust(@Req() req: { user: AuthenticatedUser }, @Body() dto: AdjustStockDto) {
    return this.inventory.adjust(req.user, dto);
  }

  @Post('transfers')
  @RequirePermissions('inventory:write')
  transfer(@Req() req: { user: AuthenticatedUser }, @Body() dto: TransferStockDto) {
    return this.inventory.transfer(req.user, dto);
  }

  @Get('warehouses/:warehouseId')
  @RequirePermissions('inventory:read')
  warehouse(@Req() req: { user: AuthenticatedUser }, @Param('warehouseId', ParseUUIDPipe) warehouseId: string) {
    return this.inventory.getWarehouse(req.user, warehouseId);
  }
}
