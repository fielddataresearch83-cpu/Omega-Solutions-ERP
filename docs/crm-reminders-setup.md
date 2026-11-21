# CRM activity reminders — free scheduler

The development API creates in-app notifications for incomplete CRM activities assigned to active company members when they are due within 24 hours or overdue. Dispatch is idempotent per activity, reminder type, and due-date value.

## One-time setup using cron-job.org

cron-job.org offers free scheduled HTTP requests, supports custom headers and POST requests, and can run jobs every 15 minutes. See its [official site](https://cron-job.org/en/) and [custom-request FAQ](https://cron-job.org/en/faq/).

1. Sign up at [cron-job.org](https://console.cron-job.org/signup) and verify your account.
2. In the cron-job.org console, create a job named **Omega CRM reminders — development**.
3. Configure the request:
   - URL: `https://<your-development-api-host>/api/internal/crm-reminders/dispatch`
   - Request method: `POST`
   - Request body: leave empty.
   - Custom request header name: `x-omega-cron-secret`
   - Custom request header value: use the exact secret configured as `CRM_REMINDER_CRON_SECRET` on the **omega-solutions-erp-9k9s** Vercel API Preview environment. Never put this secret in the URL, repository, or a public issue.
4. Set the schedule to every 15 minutes (minutes `0, 15, 30, 45`; every hour, every day, every month, every weekday). Use UTC or your preferred timezone; the 15-minute cadence is the same in any timezone.
5. Save the job and select **Test run**. A successful response should be HTTP 200 with a small JSON response such as `{"delivered":0}` or a positive delivered count. Zero means no eligible reminders were found on that run; it is not an error.
6. Check cron-job.org's execution history for successful runs. Confirm that a real, incomplete activity assigned to an active company member generates an in-app notification when due within 24 hours or overdue. Do not create test business records in the shared development database solely for this check.

### Secret handling

Configure CRM_REMINDER_CRON_SECRET in the Vercel API Preview environment and redeploy the development API before enabling the scheduler. Use the same value in cron-job.org's x-omega-cron-secret header. If the value is unavailable, generate a new random secret, save it in Vercel, redeploy, and then configure the scheduler. Never commit or share the secret.

The GitHub Actions workflow .github/workflows/crm-activity-reminders.yml runs every 15 minutes and can also be run manually. Configure the repository variable OMEGA_DEVELOPMENT_API_URL to the exact Development API base URL ending in /api, and the repository secret CRM_REMINDER_CRON_SECRET to the same value stored in Vercel Preview. The workflow fails visibly when either value is missing; a green skipped run is not treated as reminder delivery.
