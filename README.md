# Blackout Game Zone Counter — Production Hub

**Next.js 15 + Supabase PostgreSQL + TypeScript + Tailwind CSS**

The **Blackout Game Zone Counter** is an enterprise-grade, mobile-first management system designed specifically for commercial PlayStation 4, PlayStation 5, and billiards game zones. It features a luxury dark obsidian and champagne gold aesthetic, real-time live floor tracking, exact financial accounting in Ethiopian Birr (ETB), durable offline operation via IndexedDB, and a full single-elimination tournament management module.

---

## 1. System Architecture & Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript 5.7
- **Styling**: Tailwind CSS with custom Blackout design tokens (`#080B11` deep navy/black, `#D4AF37` champagne gold, PlayStation geometry)
- **Database & Auth**: Supabase PostgreSQL with Row Level Security (RLS) and Realtime WebSocket engine
- **Offline Engine**: IndexedDB with idempotency keys, automatic retry backoff, and local state caching
- **Testing**: Vitest automated test suite with full coverage for financial math, bracket generation, rate limiting, and session rules
- **Deployment**: Vercel Serverless / PWA installable

---

## 2. Complete Database Migration Sequence

All schema definitions, functions, and RLS policies are forward-only and safe for production installations. Run these migrations in order in the Supabase SQL Editor:

1. `supabase/migrations/001_core.sql`: Core tables (`game_zones`, `profiles`, `stations`, `shifts`, `sessions`, `session_events`, `audit_logs`), base RLS policies, and core session RPCs.
2. `supabase/migrations/002_limits.sql`: DB triggers enforcing station limits and employee limits per game zone plan.
3. `supabase/migrations/003_shifts.sql`: Shift open, verification, and settlement workflow.
4. `supabase/migrations/004_finance.sql`: One-time expenses, recurring monthly expenses, and profit report RPCs.
5. `supabase/migrations/005_snacks.sql`: Inventory items catalog, snack sales, and profit margin tracking.
6. `supabase/migrations/006_account.sql`: User profile update RPCs.
7. `supabase/migrations/007_admin_tools.sql`: Session edits, voids, and audit logging with mandatory justifications.
8. `supabase/migrations/008_reopen_handover.sql`: Reopen session window and employee-to-employee shift handover.
9. `supabase/migrations/009_notifications_pricing_reports.sql`: In-app notification triggers, unit type prices, and employee shift reports.
10. `supabase/migrations/010_business_settings_and_rules.sql`: Configurable business rules, FIFA tie-break policies, reopen window customization, and shift conflict resolution.
11. `supabase/migrations/011_session_lifecycle_and_idempotency.sql`: Console pause/resume, FIFA extra time and penalty surcharges, and server-side idempotency keys.
12. `supabase/migrations/012_tournaments.sql`: Tournaments schema, participant registration, single-elimination bracket generation, match scoring, and prize accounting.
13. `supabase/migrations/013_idempotent_start_session.sql`: Adds the idempotency-key argument used by queued session starts.
14. `supabase/migrations/014_realtime_sales.sql`: Enables live sales refreshes on the counter and employee day screens.
15. `supabase/migrations/015_owner_approval.sql`: Requires super-admin approval before a self-registered owner can access a game zone.
16. `supabase/migrations/016_tournament_match_authorization.sql`: Restricts match result writes to tenant owners and validates score/winner consistency.
17. `supabase/migrations/017_offline_session_ids.sql`: Uses client-generated session IDs so offline increments can queue against sessions before they reach the server.

Apply migration 017 before deploying the client changes that send `p_session_id` to `start_session`.

---

## 3. Environment Variables Configuration

Copy `.env.example` to `.env.local` for local execution or enter into Vercel Project Settings:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

> **Security Note**: `SUPABASE_SERVICE_ROLE_KEY` is exclusively utilized by server-side routes (`/api/users`) and is never leaked to browser bundles.

---

## 4. Initial Provisioning & User Roles

The system enforces three strict roles:

1. **Platform Super-Admin (`super_admin`)**: Manages game zone business tenants and quota limits at `/super`.
   Provision your first super-admin directly in Supabase SQL:
   ```sql
   insert into profiles(id, role, full_name)
   select id, 'super_admin', 'Platform Super Admin'
   from auth.users where email = 'admin@yourcompany.com';
   ```

2. **Game Zone Owner (`admin`)**:
   - Manages console stations and prices at `/manage`.
   - Monitors live consoles in real-time at `/monitor`.
   - Reviews and settles employee shifts.
   - Configures FIFA extra-time and business rules at `/settings`.
   - Accesses financial reports, exports CSVs, and logs expenses at `/finance`.
   - Creates and manages tournaments at `/tournaments`.

3. **Game Zone Employee (`employee`)**:
   - Accesses high-speed mobile counter at `/counter`.
   - Starts sessions, records games, pauses consoles, and adds snacks.
   - Reconciles cash drawer and submits daily closeout at `/counter/day`.

---

## 5. Offline Operation & Durable Synchronization

The application operates seamlessly under weak or disconnected mobile internet:

- **Durable Action Queue**: Actions (`adjust_session`, `pause_session`, `resume_session`, `end_session_idempotent`, `add_sale_idempotent`) are persisted in browser **IndexedDB** (`gz_offline_db`).
- **Idempotency**: Every state-changing network request includes a unique UUID idempotency key. Duplicate network requests or retries will never produce duplicate charges or increment game counters twice.
- **Connection Indicator (`NetBanner`)**: Displays real-time sync state (`Online & Synced`, `Offline Mode`, `Syncing`, `Sync Conflict`).
- **Local Snapshot Cache**: Active sessions, station list, and snack menu are preserved locally across browser refreshes.

---

## 6. Financial Accuracy & Accounting Standards

- **Exact Currency Precision**: Financial math is calculated with cents precision in `src/lib/finance.ts` (`addMoney`, `subMoney`, `multiplyMoney`, `calculateNetProfit`) to completely eliminate JavaScript floating-point errors (e.g. `0.1 + 0.2`).
- **P&L Reporting**:
  - `Gross Revenue`: Game session revenue + Snack revenue.
  - `Cost of Goods Sold (COGS)`: Cost price of snacks sold.
  - `Operating Expenses`: Rent, electricity, salaries, repairs, and recurring bills.
  - `Net Operating Profit`: Gross Revenue - COGS - Expenses.
- **Cash Reconciliation**: Digital payments (Telebirr, CBE Bank Transfer) are strictly isolated from physical expected cash during shift closeout.

---

## 7. FIFA & EA FC Tie-Break Rules

Game zone owners can configure how tied matches are billed without writing code (via `/settings`):
- **Free**: Extra time and penalty shootouts are included in the regular game price.
- **50% Discount**: Charged at half of the station's unit price.
- **Full Match**: Charged at the full match price.
- **Flat Fee**: Charged at a fixed configurable ETB amount.

---

## 8. Tournament Management Module

Located at `/tournaments`:
- **Creation**: Support for title, game (EA FC 25, Tekken, etc.), console kind, entry fee, prize pool, organizer expenses, and custom rules.
- **Roster & Registration**: Employee and owner registration with payment recording (Cash, Telebirr, CBE) and fee status.
- **Single-Elimination Brackets**: Automatic seed and bye computation, interactive mobile-responsive bracket view, match scoring, and walkover recording.
- **Tournament Accounting**: Tracks registered vs paid players, gross entry fees collected, prize obligations, and final net profit.

---

## 9. Automated Testing Guide

Run the full automated test suite:

```bash
npm test
```

Test coverage includes:
- `src/test/finance.test.ts`: Float drift elimination, ETB formatting, P&L calculations, shift variance.
- `src/test/tournaments.test.ts`: Single-elimination bracket sizing, bye distribution, score validations, prize accounting.
- `src/test/fifaRules.test.ts`: FIFA extra-time and penalty surcharge calculations.
- `src/test/rateLimit.test.ts`: API route sliding window abuse protection.
- `src/test/sessionRules.test.ts`: Session lifecycle, reopen window boundaries, price snapshot preservation.

---

## 10. Local Development & Deployment

### Run Locally
```bash
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### Production Build Check
```bash
npm run build
```

### Vercel Deployment
1. Connect your Git repository to Vercel.
2. In Project Settings > Environment Variables, add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Deploy. The PWA service worker and manifest (`/manifest.webmanifest`) enable full mobile home screen installation over HTTPS.

---

## 11. Database Backup & Disaster Recovery Runbook

### Backup (Daily / Weekly)
Using PostgreSQL standard tooling (`pg_dump`):
```bash
pg_dump -h db.YOUR_PROJECT.supabase.co -U postgres -d postgres -F c -b -v -f blackout_backup_$(date +%Y%m%d).dump
```

### Restore
In the event of a critical recovery requirement:
```bash
pg_restore -h db.YOUR_PROJECT.supabase.co -U postgres -d postgres -v --clean --if-exists blackout_backup_YYYYMMDD.dump
```
