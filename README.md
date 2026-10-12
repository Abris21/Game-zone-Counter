# Game Zone Counter (v1 core)
Next.js 15 + Supabase. Warm black and crimson UI, mobile-first.

## Setup
1. Create a Supabase project. Run `supabase/migrations/001_core.sql` in the SQL editor.
2. Copy `.env.example` to `.env.local` and fill the URL and anon key (Project Settings > API).
3. `npm install && npm run dev`, deploy to Vercel with the same two env vars.

## First account (only one SQL step)
1. Run `002_limits.sql`, `003_shifts.sql` and `004_finance.sql` and `005_snacks.sql` `006_account.sql` and `007_admin_tools.sql` and `008_reopen_handover.sql` and `009_notifications_pricing_reports.sql` too. In Supabase Auth settings, set the Site URL to your deployed domain and add `https://YOUR-DOMAIN/reset` to Redirect URLs; configure custom SMTP (Resend works) so reset emails are delivered. Add `SUPABASE_SERVICE_ROLE_KEY` to `.env.local` and Vercel (server only, never expose it).
2. Supabase > Authentication > add user `you@mail.com` (auto-confirm), then:
```sql
insert into profiles(id,role,full_name) select id,'super_admin','Platform owner' from auth.users where email='you@mail.com';
```
3. Sign in at `/login` > `/super`: add owners (zone, limits). Owners use `/manage` for units, prices and employees. Employees sign in with a username.

## Built
Amharic: login, employee counter, My day and snack sheet (switch language on the login screen or in Account). Ethiopian calendar option (Account) shows Ethiopian dates beside date pickers in History and Finance. Owner pages are still English.
Alerts bell with live in-app notifications (day submitted, day settled or sent back, low stock) and optional phone alerts while the app is open (not when fully closed), PDF export (opens print dialog, choose Save as PDF), per-employee breakdown in Finance, price per game by unit type with optional per-unit price.
Reopen a just-ended session (5 minutes), hand an open session to a colleague, offline queue for +1/-1 and End (starting sessions and snack sales need a connection), installable PWA (open the site over HTTPS, then use the browser menu: Add to Home screen).
History (owner edits or voids past sessions and snack sales with a required reason; settled days locked), Settings (zone name and location), Audit log viewer, forced password change on first login, suspended or closed zones blocked at the database and at login.
Account page (edit name, change password, sign out everywhere, owner delete-zone), forgot/reset password, owner resets employee passwords, security headers.
Snacks: owner Inventory (price, cost, stock, low-stock alert), employee snack sales (added to a session or paid on the spot), shift cash and profit include snacks and their cost.
Finance page: today/week/month/custom profit and loss, breakdowns by unit type, payment method and expense, daily bars, expenses (add/edit/soft-delete, audited), monthly recurring expenses, CSV export.
Employee My day (per-unit sessions, totals by payment method), close day with cash count and variance, owner Settle/Send back, audit log for shifts.
Super Admin console (owners, limits, suspend), owner Manage page (units, prices, employees, deactivate), DB-enforced limits.
Auth + role redirect, schema with RLS, race-safe RPCs (start/+1/-1/end with price snapshot, idempotent taps, one open session per unit), employee counter, admin live monitor with Realtime.
## Next (per spec)
Super Admin console, zone/unit/employee management (Edge Function for employee creation), snacks, shift close and verification, expenses and P&L, account deletion, offline queue, Amharic.
