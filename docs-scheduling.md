# Scheduling the ingest sweep

The sweep is a plain authenticated HTTP route (`/api/admin/feeds/sweep`), so any
scheduler can drive it. That was deliberate — this is too central to be locked
to one platform's cron feature.

**We drive it from Supabase**, using pg_cron + pg_net, both already in this
project's stack. Reasons:

- Vercel Cron below daily frequency needs a paid plan, and a once-a-day sweep
  of live safety warnings is worse than none: it would present 24-hour-old
  warnings as current conditions. A schedule that misleads is not a fallback.
- pg_cron lives next to the data it is filling, so the scheduler and the table
  cannot drift apart across a hosting change.

The secret is held in Supabase Vault, never in the job definition and never in
this repo. `CRON_SECRET` must also be set in the Vercel environment — the route
compares the two.

To move to Vercel Cron later (Pro plan), restore a `vercel.json` with:

    { "crons": [{ "path": "/api/admin/feeds/sweep?limit=60", "schedule": "*/10 * * * *" }] }

Vercel sends `Authorization: Bearer $CRON_SECRET` automatically, which is the
same header the route already checks. Disable the pg_cron job at the same time
so the feeds are not polled twice.
