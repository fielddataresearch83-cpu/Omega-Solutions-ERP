# CRM activity reminders — free scheduler

The development API creates in-app notifications for incomplete CRM activities assigned to active company members when they are due within 24 hours or overdue. Dispatch is idempotent per activity, reminder type, and due-date value.

## One-time setup using cron-job.org

cron-job.org offers free scheduled HTTP requests, supports custom headers and POST requests, and can run jobs every 15 minutes. See its [official site](https://cron-job.org/en/) and [custom-request FAQ](https://cron-job.org/en/faq/).

1. Sign up at [cron-job.org](https://console.cron-job.org/signup) and verify your account.
2. In the cron-job.org console, create a job named **Omega CRM reminders — development**.
3. Configure the request:
   - URL: `https://omega-solutions-api-development.onrender.com/api/internal/crm-reminders/dispatch`
   - Request method: `POST`
   - Request body: leave empty.
   - Custom request header name: `x-omega-cron-secret`
   - Custom request header value: use the exact secret configured as `CRM_REMINDER_CRON_SECRET` on the **omega-solutions-api-development** Render service. Never put this secret in the URL, repository, or a public issue.
4. Set the schedule to every 15 minutes (minutes `0, 15, 30, 45`; every hour, every day, every month, every weekday). Use UTC or your preferred timezone; the 15-minute cadence is the same in any timezone.
5. Save the job and select **Test run**. A successful response should be HTTP 200 with a small JSON response such as `{"delivered":0}` or a positive delivered count. Zero means no eligible reminders were found on that run; it is not an error.
6. Check cron-job.org's execution history for successful runs. Confirm that a real, incomplete activity assigned to an active company member generates an in-app notification when due within 24 hours or overdue. Do not create test business records in the shared development database solely for this check.

### Secret handling

The API secret has been rotated and configured on the development Render service. The service is redeploying to load it. Retrieve the value from the secure source where you manage development secrets and paste it into cron-job.org's custom header. If the value is not available to you, generate a new random secret and update the Render environment first, wait for the development deployment to finish, then use that same new value in cron-job.org. Do not send the secret through email or commit it to Git.

## Behavior and limits

- Notifications are in-app only; this does not send email or SMS.
- Completed activities and activities without a due date are ignored.
- Only active users with an active membership in the activity's company are recipients.
- Delivery is recorded in `crm_activity_reminder_deliveries`; repeated runs do not duplicate the same reminder.
- A due-soon reminder is emitted once per due-date value, and an overdue reminder is emitted once per due-date value.
- The endpoint requires a secret of at least 32 characters and uses a constant-time comparison. Missing API configuration returns service unavailable; an incorrect secret is rejected.
- This setup targets only `omega-solutions-api-development.onrender.com`. Do not point the scheduler at production.
- The CRM API continues to deny branch-bound memberships until CRM records have explicit branch attribution and all related queries enforce it. Do not remove that guard as a workaround.

## Manual development workflow

The repository also includes a manual-only GitHub Actions workflow for dispatch. It is not the recurring scheduler: GitHub scheduled workflows run from the default branch, and this project is being kept on the existing `development` branch only.
