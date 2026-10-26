import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { InvoicesService } from './invoices.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';

type StkRequest = {
  id: string;
  company_id: string;
  invoice_id: string;
  requested_by: string;
  phone_number: string;
  amount: string | number;
  account_reference: string;
  checkout_request_id: string | null;
  invoice_payment_id: string | null;
  status: string;
  mpesa_receipt_number: string | null;
  updated_at?: string | Date;
};

type CallbackItem = { Name?: string; Value?: string | number };
type StkCallback = {
  Body?: { stkCallback?: {
    CheckoutRequestID?: string;
    MerchantRequestID?: string;
    ResultCode?: number;
    ResultDesc?: string;
    CallbackMetadata?: { Item?: CallbackItem[] };
  } };
};

@Injectable()
export class MpesaService {
  private readonly logger = new Logger(MpesaService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly memberships: MembershipsService,
    private readonly invoices: InvoicesService,
  ) {}

  async initiate(user: AuthenticatedUser, invoiceId: string, phoneInput: string, amountInput: number) {
    const membership = user.companyId
      ? await this.memberships.getMembershipForCompany(user.userId, user.companyId)
      : await this.memberships.getMembership(user.userId);
    // Reuse invoice authorization so branch-bound members cannot initiate payment for another branch's invoice.
    await this.invoices.getById(user, invoiceId);
    const phone = this.normalizePhone(phoneInput);
    const amount = Math.round(Number(amountInput) * 100) / 100;
    if (!Number.isFinite(amount) || amount < 1 || !Number.isInteger(amount)) {
      throw new BadRequestException('M-Pesa STK payments must be a whole KES amount of at least KES 1.');
    }

    const invoiceResult = await this.db.query<{
      id: string; invoice_number: string; status: string; total: string | number;
      amount_paid: string | number; credited_amount: string | number;
    }>(
      'SELECT id, invoice_number, status, total, amount_paid, credited_amount FROM invoices WHERE id=$1 AND company_id=$2',
      [invoiceId, membership.companyId],
    );
    const invoice = invoiceResult.rows[0];
    if (!invoice || ['draft', 'cancelled', 'paid'].includes(invoice.status)) {
      throw new BadRequestException('Choose an issued invoice with an outstanding balance.');
    }
    const outstanding = Math.round((Number(invoice.total) - Number(invoice.amount_paid) - Number(invoice.credited_amount)) * 100) / 100;
    if (amount > outstanding) {
      throw new BadRequestException('Payment amount cannot exceed the invoice balance.');
    }

    const consumerKey = process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    const shortcode = process.env.MPESA_SHORTCODE;
    const passkey = process.env.MPESA_PASSKEY;
    const callbackUrl = process.env.MPESA_CALLBACK_URL;
    if (!consumerKey || !consumerSecret || !shortcode || !passkey || !callbackUrl) {
      throw new ServiceUnavailableException('M-Pesa is not configured yet. Ask an Omega administrator to finish Daraja setup.');
    }
    let callback: URL;
    try {
      callback = new URL(callbackUrl);
    } catch {
      throw new ServiceUnavailableException('The M-Pesa callback URL is invalid.');
    }
    if (callback.protocol !== 'https:') {
      throw new ServiceUnavailableException('The M-Pesa callback URL must use HTTPS.');
    }

    const accountReference = invoice.invoice_number.slice(0, 12);
    const inserted = await this.db.query<{ id: string }>(
      `INSERT INTO mpesa_stk_requests
        (company_id,invoice_id,requested_by,phone_number,amount,account_reference,status)
       VALUES($1,$2,$3,$4,$5,$6,'initiated') RETURNING id`,
      [membership.companyId, invoiceId, user.userId, phone, amount, accountReference],
    );
    const requestId = inserted.rows[0].id;
    const base = process.env.MPESA_ENVIRONMENT === 'production'
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke';

    try {
      const tokenResponse = await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`, {
        headers: { Authorization: `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!tokenResponse.ok) throw new Error(`Daraja OAuth returned HTTP ${tokenResponse.status}`);
      const tokenData = await tokenResponse.json() as { access_token?: string };
      if (!tokenData.access_token) throw new Error('Daraja did not return an access token.');

      const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
      const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
      const pushResponse = await fetch(`${base}/mpesa/stkpush/v1/processrequest`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          BusinessShortCode: shortcode,
          Password: password,
          Timestamp: timestamp,
          TransactionType: 'CustomerPayBillOnline',
          Amount: Math.round(amount),
          PartyA: phone,
          PartyB: shortcode,
          PhoneNumber: phone,
          CallBackURL: callback.toString(),
          AccountReference: accountReference,
          TransactionDesc: `Omega invoice ${accountReference}`,
        }),
        signal: AbortSignal.timeout(15000),
      });
      const payload = await pushResponse.json() as {
        MerchantRequestID?: string; CheckoutRequestID?: string;
        ResponseCode?: string; ResponseDescription?: string; CustomerMessage?: string;
      };
      if (!pushResponse.ok || payload.ResponseCode !== '0' || !payload.CheckoutRequestID) {
        throw new Error(payload.ResponseDescription || `Daraja STK request failed (HTTP ${pushResponse.status}).`);
      }
      await this.db.query(
        `UPDATE mpesa_stk_requests SET merchant_request_id=$1,checkout_request_id=$2,
         response_code=$3,response_description=$4,status='pending',updated_at=NOW() WHERE id=$5`,
        [payload.MerchantRequestID ?? null, payload.CheckoutRequestID, payload.ResponseCode, payload.ResponseDescription ?? null, requestId],
      );
      return { requestId, status: 'pending', message: payload.CustomerMessage ?? 'Check your phone and enter your M-Pesa PIN to approve the payment.' };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown Daraja error';
      await this.db.query(
        `UPDATE mpesa_stk_requests SET status='failed',failure_reason=$1,updated_at=NOW() WHERE id=$2`,
        [reason.slice(0, 500), requestId],
      );
      this.logger.warn(`STK initiation failed for request ${requestId}: ${reason}`);
      throw new ServiceUnavailableException('Could not initiate the M-Pesa prompt. Please try again later.');
    }
  }

  async handleCallback(payload: StkCallback): Promise<{ ResultCode: number; ResultDesc: string }> {
    const callback = payload?.Body?.stkCallback;
    const checkoutId = callback?.CheckoutRequestID;
    if (!checkoutId || typeof callback?.ResultCode !== 'number') {
      return { ResultCode: 0, ResultDesc: 'Callback received; no matching transaction details.' };
    }

    const result = await this.db.query<StkRequest>(
      `SELECT id,company_id,invoice_id,requested_by,phone_number,amount,account_reference,
       checkout_request_id,invoice_payment_id,status,mpesa_receipt_number
       FROM mpesa_stk_requests WHERE checkout_request_id=$1`,
      [checkoutId],
    );
    const request = result.rows[0];
    if (!request) {
      this.logger.warn('Received an M-Pesa callback for an unknown checkout request.');
      return { ResultCode: 0, ResultDesc: 'Callback acknowledged.' };
    }
    if (request.status === 'reconciled' || request.status === 'failed' || request.status === 'review') {
      return { ResultCode: 0, ResultDesc: 'Callback already processed.' };
    }

    const items = callback.CallbackMetadata?.Item ?? [];
    const field = (name: string) => items.find((item) => item.Name === name)?.Value;
    const receipt = field('MpesaReceiptNumber');
    const amountValue = field('Amount');
    const phoneValue = field('PhoneNumber');
    const callbackAmount = amountValue === undefined ? null : Number(amountValue);
    const callbackPhone = phoneValue === undefined ? null : this.normalizeCallbackPhone(String(phoneValue));

    if (callback.ResultCode !== 0) {
      await this.db.query(
        `UPDATE mpesa_stk_requests SET status='failed',result_code=$1,result_description=$2,
         callback_received_at=NOW(),callback_payload=$3::jsonb,updated_at=NOW() WHERE id=$4 AND status IN ('initiated','pending','processing')`,
        [String(callback.ResultCode), callback.ResultDesc ?? 'Payment was not completed.', JSON.stringify(payload), request.id],
      );
      return { ResultCode: 0, ResultDesc: 'Callback acknowledged.' };
    }

    try {
      const verified = await this.verifyDarajaCheckout(checkoutId);
      if (!verified) {
        await this.db.query(
          `UPDATE mpesa_stk_requests SET status='review',result_code='0',
           result_description='Daraja transaction status could not be independently verified.',
           callback_received_at=NOW(),callback_payload=$1::jsonb,
           failure_reason='STK query did not confirm a successful transaction.',updated_at=NOW()
           WHERE id=$2 AND status <> 'reconciled'`,
          [JSON.stringify(payload), request.id],
        );
        return { ResultCode: 0, ResultDesc: 'Callback acknowledged for review.' };
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Daraja STK query failed';
      this.logger.warn(`Unable to independently verify callback ${request.id}: ${reason}`);
      await this.db.query(
        `UPDATE mpesa_stk_requests SET status='review',failure_reason=$1,
         callback_received_at=NOW(),callback_payload=$2::jsonb,updated_at=NOW()
         WHERE id=$3 AND status <> 'reconciled'`,
        [`Daraja verification failed: ${reason}`.slice(0, 500), JSON.stringify(payload), request.id],
      );
      return { ResultCode: 0, ResultDesc: 'Callback acknowledged for review.' };
    }

    if (typeof receipt !== 'string' || !receipt.trim() ||
        callbackAmount === null || !Number.isFinite(callbackAmount) ||
        Math.round(callbackAmount * 100) !== Math.round(Number(request.amount) * 100) ||
        !callbackPhone || callbackPhone !== request.phone_number) {
      await this.db.query(
        `UPDATE mpesa_stk_requests SET status='review',result_code='0',result_description=$1,
         callback_amount=$2,callback_phone_number=$3,callback_received_at=NOW(),
         callback_payload=$4::jsonb,failure_reason='Successful callback did not match expected amount, phone, or receipt.',
         updated_at=NOW() WHERE id=$5 AND status <> 'reconciled'`,
        ['Callback requires manual review.', callbackAmount, callbackPhone, JSON.stringify(payload), request.id],
      );
      return { ResultCode: 0, ResultDesc: 'Callback acknowledged for review.' };
    }

    let paymentId = request.invoice_payment_id;
    let skipRecentProcessing = false;
    try {
      await this.db.transaction(async (client) => {
        const locked = await client.query<StkRequest>(
          'SELECT id,company_id,invoice_id,requested_by,phone_number,amount,account_reference,checkout_request_id,invoice_payment_id,status,mpesa_receipt_number,updated_at FROM mpesa_stk_requests WHERE id=$1 FOR UPDATE',
          [request.id],
        );
        const current = locked.rows[0];
        if (!current || current.status === 'reconciled' || current.status === 'review' || current.status === 'failed') return;
        if (current.status === 'processing' && current.updated_at && Date.now() - new Date(current.updated_at).getTime() < 120000) {
          skipRecentProcessing = true;
          return;
        }
        if (current.mpesa_receipt_number && current.mpesa_receipt_number !== receipt) {
          await client.query(`UPDATE mpesa_stk_requests SET status='review',failure_reason='Callback receipt changed across retries.',updated_at=NOW() WHERE id=$1`, [request.id]);
          return;
        }
        if (!current.invoice_payment_id) {
          const existing = await client.query<{ id: string }>(
            'SELECT id FROM invoice_payments WHERE company_id=$1 AND method=$2 AND reference=$3',
            [current.company_id, 'mpesa', receipt],
          );
          if (existing.rows[0]) {
            await client.query(`UPDATE mpesa_stk_requests SET status='review',failure_reason='Receipt is already linked to another payment.',updated_at=NOW() WHERE id=$1`, [request.id]);
            return;
          }
          const payment = await client.query<{ id: string }>(
            `INSERT INTO invoice_payments(company_id,invoice_id,amount,method,reference,notes,created_by,status)
             VALUES($1,$2,$3,'mpesa',$4,$5,$6,'pending') RETURNING id`,
            [current.company_id, current.invoice_id, current.amount, receipt,
              `Verified Daraja STK callback; request ${current.id}`, current.requested_by],
          );
          paymentId = payment.rows[0].id;
        } else {
          paymentId = current.invoice_payment_id;
        }
        await client.query(
          `UPDATE mpesa_stk_requests SET status='processing',invoice_payment_id=$1,mpesa_receipt_number=$2,
           result_code='0',result_description=$3,callback_amount=$4,callback_phone_number=$5,
           callback_received_at=COALESCE(callback_received_at,NOW()),callback_payload=$6::jsonb,updated_at=NOW()
           WHERE id=$7`,
          [paymentId, receipt, callback.ResultDesc ?? 'Success', callbackAmount, callbackPhone, JSON.stringify(payload), request.id],
        );
      });

      if (skipRecentProcessing) return { ResultCode: 0, ResultDesc: 'Callback already being processed.' };
      const latest = await this.db.query<StkRequest>(
        'SELECT id,company_id,invoice_id,requested_by,phone_number,amount,account_reference,checkout_request_id,invoice_payment_id,status,mpesa_receipt_number FROM mpesa_stk_requests WHERE id=$1',
        [request.id],
      );
      const processed = latest.rows[0];
      if (!processed || processed.status === 'review' || processed.status === 'reconciled' || !processed.invoice_payment_id) {
        return { ResultCode: 0, ResultDesc: 'Callback acknowledged.' };
      }
      const actingUser: AuthenticatedUser = {
        userId: processed.requested_by,
        email: '',
        fullName: 'M-Pesa callback',
        companyId: processed.company_id,
        branchId: null,
        role: 'system',
        permissions: ['payments:verify', 'payments:reconcile'],
      };
      const payment = await this.db.query<{ status: string }>(
        'SELECT status FROM invoice_payments WHERE id=$1 AND company_id=$2',
        [processed.invoice_payment_id, processed.company_id],
      );
      if (payment.rows[0]?.status === 'pending') {
        await this.invoices.confirmPayment(actingUser, processed.invoice_id, processed.invoice_payment_id);
      }
      const paymentAfter = await this.db.query<{ status: string }>(
        'SELECT status FROM invoice_payments WHERE id=$1 AND company_id=$2',
        [processed.invoice_payment_id, processed.company_id],
      );
      if (paymentAfter.rows[0]?.status === 'confirmed') {
        await this.invoices.reconcilePayment(actingUser, processed.invoice_id, processed.invoice_payment_id, receipt);
      }
      const finalPayment = await this.db.query<{ status: string }>(
        'SELECT status FROM invoice_payments WHERE id=$1 AND company_id=$2',
        [processed.invoice_payment_id, processed.company_id],
      );
      if (finalPayment.rows[0]?.status === 'reconciled') {
        await this.db.query(`UPDATE mpesa_stk_requests SET status='reconciled',updated_at=NOW() WHERE id=$1`, [request.id]);
      } else {
        await this.db.query(`UPDATE mpesa_stk_requests SET status='review',failure_reason='Payment callback was verified but automatic reconciliation did not finish.',updated_at=NOW() WHERE id=$1`, [request.id]);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown reconciliation error';
      this.logger.error(`M-Pesa callback needs review for request ${request.id}: ${reason}`);
      await this.db.query(
        `UPDATE mpesa_stk_requests SET status='review',failure_reason=$1,updated_at=NOW() WHERE id=$2 AND status <> 'reconciled'`,
        [reason.slice(0, 500), request.id],
      );
    }
    return { ResultCode: 0, ResultDesc: 'Callback acknowledged.' };
  }

  private async verifyDarajaCheckout(checkoutId: string): Promise<boolean> {
    const consumerKey = process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    const shortcode = process.env.MPESA_SHORTCODE;
    const passkey = process.env.MPESA_PASSKEY;
    if (!consumerKey || !consumerSecret || !shortcode || !passkey) {
      throw new Error('Daraja credentials are not configured for callback verification.');
    }
    const base = process.env.MPESA_ENVIRONMENT === 'production'
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke';
    const tokenResponse = await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!tokenResponse.ok) throw new Error(`Daraja OAuth returned HTTP ${tokenResponse.status}`);
    const token = await tokenResponse.json() as { access_token?: string };
    if (!token.access_token) throw new Error('Daraja did not return an access token.');
    const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
    const response = await fetch(`${base}/mpesa/stkpushquery/v1/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutId,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Daraja STK query returned HTTP ${response.status}`);
    const data = await response.json() as { ResponseCode?: string; ResultCode?: string | number };
    return String(data.ResponseCode) === '0' && String(data.ResultCode) === '0';
  }

  async getStatus(user: AuthenticatedUser, requestId: string) {
    const membership = user.companyId
      ? await this.memberships.getMembershipForCompany(user.userId, user.companyId)
      : await this.memberships.getMembership(user.userId);
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT id,invoice_id,amount,phone_number,status,mpesa_receipt_number,failure_reason,created_at,updated_at
       FROM mpesa_stk_requests m WHERE m.id=$1 AND m.company_id=$2
         AND ($3::uuid IS NULL OR EXISTS (
           SELECT 1 FROM invoices i
           JOIN pos_sales ps ON ps.invoice_id=i.id AND ps.company_id=i.company_id
           JOIN pos_registers pr ON pr.id=ps.register_id AND pr.company_id=ps.company_id
           WHERE i.id=m.invoice_id AND i.company_id=m.company_id AND pr.branch_id=$3::uuid
         ))`,
      [requestId, membership.companyId, membership.branchId ?? null],
    );
    if (!result.rows[0]) throw new BadRequestException('M-Pesa request not found.');
    return result.rows[0];
  }

  private normalizePhone(value: string): string {
    const digits = value.replace(/[\s()+-]/g, '');
    const normalized = digits.startsWith('0') ? `254${digits.slice(1)}` : digits.startsWith('254') ? digits : digits.startsWith('7') || digits.startsWith('1') ? `254${digits}` : digits;
    if (!/^254[17]\d{8}$/.test(normalized)) {
      throw new BadRequestException('Enter a valid Kenyan mobile number, e.g. 0712345678 or 254712345678.');
    }
    return normalized;
  }

  private normalizeCallbackPhone(value: string): string | null {
    const digits = value.replace(/\D/g, '');
    if (!digits) return null;
    return digits.startsWith('0') ? `254${digits.slice(1)}` : digits.startsWith('254') ? digits : digits;
  }
}
