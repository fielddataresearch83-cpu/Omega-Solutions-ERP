# Daraja M-Pesa STK Push setup (development)

This integration is deliberately disabled until Daraja credentials are configured. Never commit credentials or place them in frontend environment variables.

Set these **server-side Vercel API Preview environment variables** on the Vercel API Preview environment:

- `MPESA_CONSUMER_KEY`: Daraja app consumer key.
- `MPESA_CONSUMER_SECRET`: Daraja app consumer secret.
- `MPESA_SHORTCODE`: the Paybill/Till shortcode enabled for the Daraja app.
- `MPESA_PASSKEY`: the STK Push passkey issued for that shortcode.
- `MPESA_CALLBACK_URL`: public HTTPS URL ending in `/api/mpesa/callback`, pointing to the Vercel API Preview environment.
- `MPESA_ENVIRONMENT`: `sandbox` while using Safaricom's sandbox; set to `production` only after separate live-payment approval and successful sandbox verification.

The callback endpoint is `POST /api/mpesa/callback`. STK initiation is `POST /api/mpesa/stk-push` with an authenticated Omega session and `payments:write` permission. The request body contains `invoiceId`, `phoneNumber`, and `amount` (whole KES shillings). Request status is available at `GET /api/mpesa/stk-push/:id` with `payments:read` permission.

Before activating this integration:
1. Run the API migration runner against the **development Neon database only**: `cd api && npm run migrate`.
2. Configure Daraja sandbox credentials and a reachable HTTPS callback URL.
3. Pass CI, build, callback/idempotency tests, and a real sandbox STK Push.
4. Confirm a successful callback is independently verified using Daraja STK Query, matches the requested amount and phone, and produces exactly one invoice receipt and balanced journal entry.
5. Keep unmatched, duplicate, partial, or inconsistent callbacks in review. Do not enable live Daraja credentials until explicitly approved.

Callbacks are acknowledged to Safaricom even when they need manual review; inspect `mpesa_stk_requests.status` and `failure_reason` to investigate those cases. The table stores the callback payload for audit/debugging, so keep access to the development database restricted.
