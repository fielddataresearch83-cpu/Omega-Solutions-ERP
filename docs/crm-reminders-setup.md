# CRM activity reminder scheduler

The development API generates in-app notifications for incomplete CRM activities assigned to active company members when they are due within 24 hours or overdue. Dispatch is idempotent per activity, reminder type, and due-date value.

## One-time development setup

1. Generate a random secret of at least 32 characters (PowerShell example):
   `[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))`
2. Add `CRM_REMINDER_CRON_SECRET` to the Render environment for **omega-solutions-api-development**, using that secret. Do not set this on production.
3. Redeploy only the development API so the new environment variable is loaded.
4. Create a Render cron job on the existing `development` branch with the same secret and the command below. Set its schedule to `*/15 * * * *`, use the free plan if available, and do not point it at production:
   - Build command: `echo 'No build required'`
   - Start command: `node --input-type=module -e 'const s=process.env.CRM_REMINDER_CRON_SECRET; if(!s) throw Error("missing scheduler secret"); const r=await fetch(process.env.API_BASE_URL+"/api/internal/crm-reminders/dispatch",{method:"POST",headers:{"x-omega-cron-secret":s}}); const body=await r.text(); console.log(body); if(!r.ok) process.exit(1);'`
   - Environment variables: `API_BASE_URL=https://omega-solutions-api-development.onrender.com` and `CRM_REMINDER_CRON_SECRET` with the same secret as the API.
5. Manually run the cron job once. A successful HTTP response confirms the endpoint is reachable; it does not require or create sample business data.
6. Confirm a real, incomplete CRM activity assigned to an active company member appears in that member's in-app notifications when it is due within 24 hours or overdue. Do not create test business records in the shared development database solely for this check.

The Render cron job calls the development API every 15 minutes. The GitHub Actions workflow is manual-only because scheduled GitHub workflows run from the repository's default branch, which is intentionally outside this development-only change. The API endpoint returns service unavailable if its secret is absent or too short, and uses a constant-time secret comparison outside normal user-authenticated CRM routes.

## Behavior and limits

- Notifications are in-app only; this does not send email or SMS.
- Completed activities and activities without a due date are ignored.
- Only active users with an active membership in the activity's company are recipients.
- Delivery is recorded in `crm_activity_reminder_deliveries`; repeat scheduler runs do not duplicate the same reminder.
- A due-soon reminder is emitted once per due-date value, and an overdue reminder is emitted once per due-date value.
- The CRM API continues to deny branch-bound memberships until CRM records have explicit branch attribution and all related queries enforce it. Do not remove that guard as a workaround.
