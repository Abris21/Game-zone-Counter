# Master Implementation Progress — Blackout Game Zone Counter

## Phase A: Baseline Audit and Checkpoint
- [x] Initialized Git repository and created baseline commit
- [x] Created `feature/upgrade-blackout` branch
- [x] Ran baseline build check & identified root causes (Next.js font network hang, Supabase client initialization without env vars at build time)
- [x] Audited all 9 existing database migrations, RLS policies, RPCs, API routes, and components
- [x] Mapped out missing features, security vulnerabilities, and UX limitations

## Phase B: Authentication, Authorization and Security
- [ ] Implement robust Next.js authentication middleware & route protection (redirect unauthorized users, prevent cross-role access)
- [ ] Safe Supabase client initialization (lazy client getters, resilient build handling without crashing on missing env vars)
- [ ] Harden `/api/users/route.ts` (strict action validation, role verification, sanitize inputs, rate limiting protection)
- [ ] Prevent client-side role forgery (server-authoritative role verification rather than trusting `localStorage`)
- [ ] Audit RLS policies & ensure multi-tenant zone isolation

## Phase C: Financial Correctness, Session Reliability & Business Rules
- [ ] Implement integer / exact decimal arithmetic helpers for ETB currency (prevent JS floating point errors)
- [ ] Fix shift rejection `SHIFT_CONFLICT` bug and ensure audit trails on corrections
- [ ] Implement configurable game zone settings:
  - FIFA extra time & penalty shootouts billing rules (included, extra charge, flat fee, employee prompt)
  - Station types, custom durations, break / pause durations, reopen window
  - Shift reconciliation settings and Addis Ababa timezone enforcement
- [ ] Database migration `010_business_settings_and_rules.sql`
- [ ] Database migration `011_session_lifecycle_and_idempotency.sql` (pause/resume, FIFA tie-break rule snapshot, server-authoritative timestamps)

## Phase D: Offline Operation & Durable Synchronization
- [ ] Upgrade offline architecture from simple localStorage to durable IndexedDB queue
- [ ] Enforce idempotency keys on all state-changing operations (adjust, end session, snack sale, payments)
- [ ] Offline status banner & synchronization drawer:
  - Online & synced
  - Offline mode
  - Syncing in progress
  - Sync conflict & error recovery controls
  - Last synced timestamp display
- [ ] Safe local cache snapshot for stations, sessions, menu, and pricing rules

## Phase E: Tournament Management Module
- [ ] Database migration `012_tournaments.sql`:
  - `tournaments` table (game, format, entry fee, prize pool, max players, status, rules)
  - `tournament_participants` table (player name, contact, entry fee payment status, payment method)
  - `tournament_matches` table (round, match number, player 1, player 2, scores, winner, walkover, next match)
  - Tournament accounting RPCs (revenue, prizes paid, expenses, net profit)
  - RLS policies for owner and employee access
- [ ] Tournament management interface (`/tournaments`):
  - Owner dashboard for creating and managing tournaments
  - Interactive single-elimination visual bracket view (responsive for mobile and desktop)
  - Match scoring & winner progression workflow
  - Player registration & payment recording modal
  - Financial summary cards (gross entry fees, prizes, profit)

## Phase F: Application-wide UI/UX Redesign
- [ ] Establish cohesive Blackout luxury design system:
  - Deep obsidian / navy background (`#0B0E17`, `#111625`, `#182032`)
  - Warm champagne gold accents (`#D4AF37`, `#F3E5AB`, `#E5C158`)
  - High-contrast typography with PlayStation aesthetic elements
  - Standardized component library (AppLayout, Sidebar, MobileNav, Card, Button, Badge, Modal, Toast, Skeleton, EmptyState)
- [ ] Redesign every screen:
  1. Login, Forgot Password, Reset Password
  2. Employee Live Zone (`/counter`) — ultra-fast touch controls, PlayStation controller icons, quick snack drawer
  3. Employee Shift & Closeout (`/counter/day`) — cash calculation, variance breakdown, submit modal
  4. Owner Live Floor Monitor (`/monitor`) — real-time station cards, pending shifts alerts
  5. Units & Staff Management (`/manage`) — station configuration, unit pricing, employee accounts
  6. Finance Dashboard & Reports (`/finance`) — P&L breakdown, charts, CSV & print-ready reports
  7. Inventory & Snack Sales (`/inventory`) — stock levels, margin calculator, low-stock warnings
  8. History & Adjustments (`/history`) — session logs, audited edit/void modal
  9. Business Settings (`/settings`) — PlayStation rules, FIFA extra time rules, reopen window, timezone
  10. Audit Logs (`/audit`) — structured change logs with diff view
  11. Account Management (`/account`) — profile, password change, preferences, zone danger zone
  12. Platform Admin (`/super`) — game zone provisioning, quota limits, suspension
  13. Tournaments (`/tournaments`) — bracket viewer, match recorder, player roster
  14. Error, 404, Unauthorized, and Offline status views
- [ ] Expanded Amharic & English translations across all screens

## Phase G: Automated Testing, Documentation & Deployment Checks
- [ ] Install Vitest and testing setup
- [ ] Unit & integration tests:
  - Financial calculations & shift variance
  - FIFA extra time & price snapshot calculation
  - Idempotency & offline queue serialization
  - Tournament single-elimination bracket progression & accounting
  - Authentication & role verification
- [ ] Run full test suite & production build validation
- [ ] Comprehensive README with setup guide, migrations runbook, backup/restore procedures, and local testing instructions
