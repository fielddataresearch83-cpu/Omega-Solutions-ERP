import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database.service.js';

type PaystackResponse<T> = { status: boolean; message?: string; data?: T };
type InitializedTransaction = { authorization_url: string; access_code: string; reference: string };
type VerifiedTransaction = {
  id: number | string;
  status: string;
  reference: string;
  amount: number;
  currency: string;
  domain?: string;
  paid_at?: string;
};

@Injectable()
export class PaystackPaymentsService {
  private readonly logger = new Logger(PaystackPaymentsService.name);

  constructor(private readonly db: DatabaseService) {
    // Log only boolean configuration diagnostics; never log credentials or key fragments.
    const key = process.env.PAYSTACK_SECRET_KEY?.trim();
    this.logger.log(
      `Paystack test configuration: modeIsTest=${process.env.PAYSTACK_MODE === 'test'}, ` +
      `secretKeyPresent=${Boolean(key)}, secretKeyHasTestPrefix=${Boolean(key?.startsWith('sk_test_'))}`,
    );
  }

  private secretKey(): string {
    const mode = process.env.PAYSTACK_MODE;
    const key = process.env.PAYSTACK_SECRET_KEY?.trim();
    // Development deliberately accepts test keys only. This prevents accidentally
    // charging real customers from the development API.
    if (mode !== 'test') {
      throw new ServiceUnavailableException(
        'Paystack configuration check failed: the development API process does not see PAYSTACK_MODE=test. Verify the variable is saved on the omega-solutions-api-development Render service and restart/redeploy that service.',
      );
    }
    if (!key) {
      throw new ServiceUnavailableException(
        'Paystack configuration check failed: PAYSTACK_SECRET_KEY is missing or empty in the development API process.',
      );
    }
    if (!key.startsWith('sk_test_')) {
      throw new ServiceUnavailableException(
        'Paystack configuration check failed: PAYSTACK_SECRET_KEY is present but is not a Test Secret Key (expected the sk_test_ prefix). No key value was logged.',
      );
    }
    return key;
  }

  async initializeSubscriptionCheckout(
    companyId: string,
    userId: string,
    email: string,
    planCode: string,
  ) {
    const normalizedPlan = planCode.trim().toLowerCase();
    const planResult = await this.db.query<{
      code: string; name: string; monthly_price_kes: number; is_custom_pricing: boolean;
    }>(
      'SELECT code, name, monthly_price_kes, is_custom_pricing FROM subscription_plans WHERE code = $1 AND is_active = TRUE',
      [normalizedPlan],
    );
    const plan = planResult.rows[0];
    if (!plan) throw new BadRequestException('The selected subscription plan is not available.');
    if (plan.is_custom_pricing) throw new BadRequestException('Enterprise requires a custom quote. Submit an Enterprise quote request instead of using online checkout.');
    const key = this.secretKey();

    const existing = await this.db.query<{ plan_code: string; status: string }>(
      'SELECT plan_code, status FROM company_subscriptions WHERE company_id = $1',
      [companyId],
    );
    if (existing.rows[0] && ['active', 'trialing'].includes(existing.rows[0].status)
      && existing.rows[0].plan_code !== normalizedPlan) {
      throw new BadRequestException(
        'Your company already has an active subscription. Submit a plan-change request before paying for a different plan.',
      );
    }

    const amountKes = Number(plan.monthly_price_kes);
    if (!Number.isSafeInteger(amountKes) || amountKes <= 0) {
      throw new ServiceUnavailableException('The selected plan has an invalid price.');
    }
    const reference = `omega-sub-${cryptoRandomReference()}`;
    await this.db.query(
      `INSERT INTO subscription_payments
         (company_id, requested_by, plan_code, reference, amount_kes, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [companyId, userId, normalizedPlan, reference, amountKes],
    );

    const callbackUrl = process.env.PAYSTACK_CALLBACK_URL?.trim();
    const payload: Record<string, unknown> = {
      email,
      amount: String(amountKes * 100),
      currency: 'KES',
      reference,
      metadata: {
        purpose: 'omega_subscription',
        company_id: companyId,
        requested_by: userId,
        plan_code: normalizedPlan,
      },
    };
    if (callbackUrl) payload.callback_url = callbackUrl;

    try {
      const response = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12000),
      });
      const result = await response.json() as PaystackResponse<InitializedTransaction>;
      if (!response.ok || !result.status || !result.data?.authorization_url
        || result.data.reference !== reference) {
        throw new Error('Paystack did not return a valid checkout URL.');
      }
      await this.db.query(
        `UPDATE subscription_payments
         SET authorization_url = $2, updated_at = NOW()
         WHERE reference = $1 AND status = 'pending'`,
        [reference, result.data.authorization_url],
      );
      return {
        provider: 'paystack',
        reference,
        authorizationUrl: result.data.authorization_url,
        amountKes,
        currency: 'KES',
        planCode: normalizedPlan,
        planName: plan.name,
        status: 'pending',
      };
    } catch {
      // Keep the ledger row pending after a network/timeout error: Paystack may
      // have created the transaction before the connection failed. A later signed
      // webhook can still verify it safely; never mark it paid from this request.
      throw new ServiceUnavailableException(
        'Unable to confirm Paystack checkout initialization. No subscription has been activated; you may retry or contact support if you received a checkout link.',
      );
    }
  }

  async getCompanyPayment(companyId: string, reference: string) {
    const result = await this.db.query<{
      reference: string; plan_code: string; amount_kes: number;
      currency: string; status: string; paid_at: Date | null; created_at: Date;
    }>(
      `SELECT reference, plan_code, amount_kes, currency, status, paid_at, created_at
       FROM subscription_payments WHERE company_id = $1 AND reference = $2`,
      [companyId, reference],
    );
    if (!result.rows[0]) throw new BadRequestException('Payment reference was not found for this company.');
    return result.rows[0];
  }

  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined, event: unknown) {
    const key = this.secretKey();
    if (!rawBody || !signature) throw new UnauthorizedException('Missing Paystack signature.');
    const expected = createHmac('sha512', key).update(rawBody).digest();
    let supplied: Buffer;
    try {
      supplied = Buffer.from(signature, 'hex');
    } catch {
      throw new UnauthorizedException('Invalid Paystack signature.');
    }
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw new UnauthorizedException('Invalid Paystack signature.');
    }

    const payload = event as {
      event?: string;
      data?: { reference?: string };
    };
    if (payload?.event !== 'charge.success' || !payload.data?.reference) {
      return { received: true, processed: false };
    }

    const paymentResult = await this.db.query<{
      company_id: string; plan_code: string; amount_kes: number; status: string;
    }>(
      'SELECT company_id, plan_code, amount_kes, status FROM subscription_payments WHERE reference = $1',
      [payload.data.reference],
    );
    const payment = paymentResult.rows[0];
    if (!payment) return { received: true, processed: false };
    if (payment.status === 'success') return { received: true, processed: true, duplicate: true };

    // Never trust webhook data alone; confirm the transaction with Paystack's API.
    const verifyResponse = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(payload.data.reference)}`,
      {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(12000),
      },
    );
    const verification = await verifyResponse.json() as PaystackResponse<VerifiedTransaction>;
    const transaction = verification.data;
    if (!verifyResponse.ok || !verification.status || !transaction
      || transaction.status !== 'success'
      || transaction.reference !== payload.data.reference
      || transaction.currency !== 'KES'
      || transaction.amount !== payment.amount_kes * 100
      || (transaction.domain && transaction.domain !== 'test')) {
      // Leave the payment pending for investigation/retry; never grant access on a mismatch.
      return { received: true, processed: false };
    }

    await this.db.transaction(async (client: PoolClient) => {
      const locked = await client.query<{
        company_id: string; plan_code: string; amount_kes: number; status: string;
      }>(
        'SELECT company_id, plan_code, amount_kes, status FROM subscription_payments WHERE reference = $1 FOR UPDATE',
        [payload.data!.reference],
      );
      const current = locked.rows[0];
      if (!current || current.status === 'success') return;
      if (current.status !== 'pending'
        || current.company_id !== payment.company_id
        || current.plan_code !== payment.plan_code
        || Number(current.amount_kes) !== Number(payment.amount_kes)) return;

      await client.query(
        `UPDATE subscription_payments
         SET status = 'success', provider_transaction_id = $2,
             provider_payload = $3::jsonb, paid_at = COALESCE($4::timestamptz, NOW()),
             updated_at = NOW()
         WHERE reference = $1 AND status = 'pending'`,
        [
          payload.data!.reference,
          String(transaction.id),
          JSON.stringify({ event: payload.event, transaction }),
          transaction.paid_at ?? null,
        ],
      );

      await client.query(
        `INSERT INTO company_subscriptions
           (company_id, plan_code, status, billing_period, started_at,
            current_period_start, current_period_end, created_at, updated_at)
         VALUES ($1, $2, 'active', 'monthly', NOW(), NOW(), NOW() + INTERVAL '1 month', NOW(), NOW())
         ON CONFLICT (company_id) DO UPDATE SET
           plan_code = EXCLUDED.plan_code,
           status = 'active',
           billing_period = 'monthly',
           started_at = COALESCE(company_subscriptions.started_at, NOW()),
           current_period_start = GREATEST(COALESCE(company_subscriptions.current_period_end, NOW()), NOW()),
           current_period_end = GREATEST(COALESCE(company_subscriptions.current_period_end, NOW()), NOW()) + INTERVAL '1 month',
           cancelled_at = NULL,
           updated_at = NOW()`,
        [current.company_id, current.plan_code],
      );
    });

    return { received: true, processed: true };
  }
}

function cryptoRandomReference(): string {
  // UUID without punctuation keeps the provider reference within Paystack's allowed characters.
  return globalThis.crypto.randomUUID().replace(/-/g, '');
}
