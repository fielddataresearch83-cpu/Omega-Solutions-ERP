import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Param,
  Request,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { PaystackPaymentsService } from './paystack-payments.service.js';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly paystackPayments: PaystackPaymentsService,
  ) {}

  @Get('plans')
  getPlans() {
    return this.subscriptions.getPlans();
  }


  @Get('modules')
  @UseGuards(JwtAuthGuard)
  getModuleCatalogue(@Request() req: { user: AuthenticatedUser }) {
    if (!req.user.companyId) {
      throw new UnauthorizedException('Select a company before viewing module availability.');
    }
    return this.subscriptions.getModuleCatalogue(req.user.companyId);
  }

  @Get('current')
  @UseGuards(JwtAuthGuard)
  getCurrent(@Request() req: { user: AuthenticatedUser }) {
    if (!req.user.companyId) {
      throw new UnauthorizedException('Select a company before viewing its subscription.');
    }
    return this.subscriptions.getCurrent(req.user.companyId);
  }

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  initializeCheckout(
    @Request() req: { user: AuthenticatedUser },
    @Body() body: { planCode?: string },
  ) {
    if (!req.user.companyId) {
      throw new UnauthorizedException('Select a company before starting subscription checkout.');
    }
    if (!['owner', 'admin'].includes(req.user.role.toLowerCase())) {
      throw new ForbiddenException('Only company owners or administrators can pay for a subscription.');
    }
    return this.paystackPayments.initializeSubscriptionCheckout(
      req.user.companyId,
      req.user.userId,
      req.user.email,
      body?.planCode ?? '',
    );
  }

  @Get('payments/:reference')
  @UseGuards(JwtAuthGuard)
  getPayment(
    @Request() req: { user: AuthenticatedUser },
    @Param('reference') reference: string,
  ) {
    if (!req.user.companyId) {
      throw new UnauthorizedException('Select a company before viewing subscription payments.');
    }
    if (!['owner', 'admin'].includes(req.user.role.toLowerCase())) {
      throw new ForbiddenException('Only company owners or administrators can view subscription payments.');
    }
    return this.paystackPayments.getCompanyPayment(req.user.companyId, reference);
  }

  @Post('paystack/webhook')
  async paystackWebhook(
    @Request() req: {
      rawBody?: Buffer;
      headers: Record<string, string | string[] | undefined>;
      body: unknown;
    },
  ) {
    const signature = req.headers['x-paystack-signature'];
    return this.paystackPayments.handleWebhook(
      req.rawBody,
      Array.isArray(signature) ? signature[0] : signature,
      req.body,
    );
  }

  @Post('change-requests')
  @UseGuards(JwtAuthGuard)
  requestPlanChange(
    @Request() req: { user: AuthenticatedUser },
    @Body() body: { planCode?: string; note?: string },
  ) {
    if (!req.user.companyId) {
      throw new UnauthorizedException('Select a company before requesting a plan.');
    }
    if (!['owner', 'admin'].includes(req.user.role.toLowerCase())) {
      throw new ForbiddenException('Only company owners or administrators can request plan changes.');
    }
    return this.subscriptions.requestPlanChange(
      req.user.companyId,
      req.user.userId,
      body?.planCode ?? '',
      body?.note,
    );
  }
  @Post('module-requests')
  @UseGuards(JwtAuthGuard)
  requestModuleChange(
    @Request() req: { user: AuthenticatedUser },
    @Body() body: { moduleCode?: string; note?: string },
  ) {
    if (!req.user.companyId) throw new UnauthorizedException('Select a company before requesting an add-on module.');
    if (!['owner', 'admin'].includes(req.user.role.toLowerCase())) {
      throw new ForbiddenException('Only company owners or administrators can request add-on modules.');
    }
    return this.subscriptions.requestModuleChange(
      req.user.companyId, req.user.userId, body?.moduleCode ?? '', body?.note,
    );
  }

}
