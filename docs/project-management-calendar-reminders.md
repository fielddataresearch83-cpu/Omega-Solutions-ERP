# Project Management calendar reminders — development

Calendar reminders are delivered as company-scoped in-app notifications. The scheduler checks every 15 minutes for non-cancelled events starting within the next 24 hours. A delivery ledger prevents duplicate notifications for the same event, recipient, and start time.

## Development scheduler

1. Configure `PROJECT_EVENT_REMINDER_CRON_SECRET` on the **Vercel API Development environment only**. Use a randomly generated value of at least 32 characters. Do not commit or share it.
2. Configure a free HTTP scheduler (for example, cron-job.org) to send a POST every 15 minutes to:
   `https://<your-development-api-host>/api/internal/project-event-reminders/dispatch`
3. Add the request header `x-omega-cron-secret` with the same secret.
4. A successful run returns JSON containing `delivered`. Zero is normal when no event is within its reminder window.
5. Verify using an event in the development database and the recipient's in-app notification list.

The recipient list includes the event creator and any listed attendee whose email matches an active user with an active membership in the same company. External attendees are retained on the event but do not receive Omega notifications. No email or SMS is sent. Editing the event start time creates a new reminder opportunity; cancellation or disabling the reminder prevents delivery.

Do not point the scheduler at Production. Do not use Render. The migration must be applied through the agreed manual migration process; this change does not apply it to any database.
