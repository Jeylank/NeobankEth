# Habeshare Mobile App

## Overview
Habeshare is a non-custodial mobile banking application built with Expo React Native, offering web support. It facilitates financial services such as remittance tracking, bill payments, and KYC verification, primarily for the Ethiopian diaspora, without holding user funds directly. All transactions are processed through licensed financial institutions in Ethiopia. The project aims to provide a comprehensive and secure platform for managing financial interactions with Ethiopia, including features like family support automation, group funding (Family Circle, Support Campaigns), and multi-currency management with transparent FX services.

## User Preferences
I want to interact with you in a clear and concise manner. Prioritize high-level architectural and design decisions over minute implementation details. When proposing changes or explaining concepts, focus on the 'why' before the 'how'. For development tasks, I prefer an iterative approach, with clear checkpoints and opportunities for feedback. Do not introduce new external dependencies or significant architectural changes without prior discussion and approval.

## System Architecture
The application is built with Expo SDK 50, React Native 0.73, React Navigation 6, and TypeScript. Firebase is used for authentication and notifications, with TanStack React Query for data fetching.

**Core Features & Technical Implementations:**
- **User Authentication & KYC:** Firebase for authentication, phone number pre-validation (+251), and ID document scanning/upload integrated with Firebase Storage.
- **Multi-Language Support:** Comprehensive i18n with support for English, Amharic, Oromo, and Tigrinya.
- **Non-Custodial Model:** Habeshare acts as an intermediary, with funds processed by Ethiopian financial institutions. The system maintains transaction status summaries (Money Sent, Delivered, Pending) instead of wallet balances.
- **Family Support Features:**
    - **Family Wallet:** Track monthly support for family members, with allocation tracking and a "Send Now" option. Data persisted in Firebase Firestore.
    - **Family Request:** Allows family members in Ethiopia to request financial support, with approval/decline workflows and notification integration.
    - **Recurring Support Automation:** Schedule automated payments (weekly, monthly, etc.) with CRUD operations, execution history, and a processing engine for payouts.
    - **Family Circle (Group Support):** Enables multiple diaspora members to pool contributions for a shared family member, with tracking and payout processing.
- **Support Campaigns:** Fundraising functionality for various causes (medical, education, emergency) with contribution tracking and goal-based completion.
- **Multi-Currency Wallet:** Ledger-based architecture for EUR/USD/GBP balances, immutable ledger entries, wallet operations (credit, debit, reservation), and currency conversion with FX rates. Top-up options include Card, Chapa, and Telebirr.
- **Transparent FX:** Displays live foreign exchange rate comparisons from competing banks, a rate calculator with fee breakdowns, and quick conversion links.
- **Notifications System:** In-app notifications with type-based filtering, read/unread states, and unread counts, connected to Firestore.
- **Security:** Session management (auto-logout), biometric confirmation for sensitive actions, input sanitization, amount validation, account masking, and security settings.
- **Payout Connectors:** Integration with Chapa, Telebirr, and various Ethiopian banks (Dashen, Awash, CBE, Abyssinia) for initiating and tracking payouts, including retry mechanisms.
- **Admin Operations Console:** A suite of admin screens for monitoring payouts, fraud alerts, support tickets, disputes, liquidity, partner settlements (net balance by provider), and reconciliation reports (daily mismatch tracking), with role-based access control. Includes `AdminSystemMonitorScreen` (health banner, infrastructure cards, operational metrics, 5 security control badges) and `AdminSchedulerHistoryScreen` (cron job run history). Route: `AdminSystemMonitor` registered in RootNavigator; menu card added to AdminConsoleScreen.
- **FX Marketplace:** Compares and selects best FX rates from various banks for remittances, including quote expiration, liquidity reservation, and audit logging.
- **Reconciliation Engine:** A ledger-matching system comparing internal records with external provider settlement reports to detect discrepancies and generate alerts. Top-level facade at `src/services/reconciliationService.ts` with `runDailyReconciliation()`, `getAdminReconciliationSummary()`, `getMismatchedReports()`, `getTransactionFlag()`. Writes to: `reconciliation_reports` (per-transaction MATCHED/MISMATCH/MISSING schema), `transaction_flags` (RECONCILIATION_ALERT flags without modifying source data), `reconciliation_audit_log`. Emits audit events: `reconciliation_run_started`, `reconciliation_mismatch_detected`, `reconciliation_completed`. Admin endpoint: `adminService.getReconciliationAdminSummary()` → `{ totalTransactions, matched, mismatched, pending }`. Full engine at `src/services/reconciliation/` (reconciliation_runs, reconciliation_items, reconciliation_alerts, provider_settlement_reports).
- **Treasury Engine:** Manages liquidity and settlement with defined liquidity pools, reservations, settlement obligations, and alerts for critical thresholds (e.g., low liquidity, overdue settlements).
- **Settlement Engine:** Production-grade settlement orchestration in `src/services/settlement/`. Services: `settlementService` (obligation lifecycle, idempotency), `settlementLedgerService` (immutable movement ledger), `settlementBatchService` (daily batch process/settle/fail), `settlementReconciliationService` (partner-reported vs internal comparison), `settlementAlertsService` (overdue/mismatch/exposure alerts), `schedulerHistoryService` (Firestore `scheduler_runs` CRUD). Firestore collections: `se_obligations`, `settlement_batches`, `settlement_movements`, `settlement_alerts`, `settlement_reconciliation_reports`, `scheduler_runs`. Admin screens: `AdminSettlementOverviewScreen`, `AdminSettlementEngineObligationsScreen`, `AdminSettlementBatchesScreen`, `AdminSettlementAlertsScreen`, `AdminSettlementReconciliationScreen`, `AdminSchedulerHistoryScreen`.
- **Recurring Support Backend Worker:** `src/workers/recurringSupportWorker.ts` — hourly cron job that uses Firestore `collectionGroup` to query all due `recurring_schedules` across all users. For each: validates user status + amount, creates payout job in `job_queue`, writes to `scheduled_support_executions`, advances `nextPayoutDate` only on success, sends failures to `dead_letter_queue`. Logs every run to `scheduler_runs` (job=`recurring_support`). Standalone runner: `scripts/runRecurringSupportWorker.ts` (`npm run worker:recurring-support`). Admin screen: `AdminSchedulerRunsScreen` with run history, per-run drill-down modal, failed execution list. Service: `src/services/recurringSupport/scheduledSupportExecutionService.ts` manages `scheduled_support_executions` collection + `getSchedulerRuns()` + `getSchedulerRunDetails(runId)`.
- **Backend Settlement Worker:** `src/workers/settlementWorker.ts` exports three cron job functions (`processDailySettlement`, `runReconciliation`, `detectOverdueSettlements`, `runFullSettlementSchedule`). Standalone runner at `scripts/runSettlementWorker.ts` uses node-cron to schedule: 02:00 UTC daily settlement batching, 03:00 UTC reconciliation, hourly overdue detection. Run with `npm run worker:settlement`. All runs logged to `scheduler_runs` with status SUCCESS/PARTIAL/FAILED, duration, and error details.
- **Advanced Remittance Features:**
    - **Delivery Time Estimator:** Provides estimated delivery times based on payout method and bank.
    - **Live Transfer Tracking:** Real-time, step-by-step tracking of remittances.
    - **Rate Lock:** Allows users to lock in an FX rate for a limited time.
    - **Smart Recipient List:** Manage and select saved recipients for quick transfers.
    - **Transfer Fee Simulator:** Detailed breakdown of all transfer-related fees.

**UI/UX:**
- Consistent design across platforms (mobile and web).
- Usage of custom Ethiopic fonts (NotoSansEthiopic).
- Intuitive navigation with React Navigation.
- Clear presentation of financial data, including donut charts for allocation tracking and progress visualization for campaigns.
- Color-coded badges for delivery time estimates.

## Admin Operations API (Express Server)

A standalone Node.js/Express/TypeScript server at `server/`. Run with `npm run server:admin` (default port 4000).

**Authorization:** Every route requires a valid Firebase ID token (`Authorization: Bearer <token>`). The `verifyAdmin` middleware checks `isAdmin: true` custom claim OR `role: "admin"` in the Firestore `users` document.

**Endpoints:**
- `GET  /api/admin/payouts` — list payout transactions; filters: `?status=`, `?provider=`, `?dateFrom=`, `?dateTo=`
- `GET  /api/admin/fraud-alerts` — list fraud alerts; filter: `?status=`
- `POST /api/admin/fraud-action` — `{ txId, action: APPROVE|BLOCK|FREEZE }` → writes `transaction_flags`, audit log
- `GET  /api/admin/support-tickets` — list support tickets; filter: `?status=`, `?userId=`
- `POST /api/admin/support-action` — `{ ticketId, action: IN_REVIEW|RESOLVED|CLOSED }`
- `GET  /api/admin/disputes` — list disputes; filter: `?status=`, `?userId=`
- `POST /api/admin/dispute-action` — `{ disputeId, action: INVESTIGATE|REFUND|REJECT|RESOLVE }`
- `GET  /api/admin/liquidity` — per-bank positions from `treasury_liquidity`; filter: `?currency=`, `?bank=`
- `GET  /api/admin/reconciliation` — summary `{ totalTransactions, matched, mismatched, pending }`
- `GET  /api/admin/reconciliation/runs` — list reconciliation runs
- `GET  /api/admin/reconciliation/run/:runId` — run detail + items
- `GET  /api/admin/reconciliation/alerts` — open alerts; filter: `?status=`, `?severity=`
- `POST /api/admin/reconciliation/run` — trigger manual run `{ provider, dateRangeHours }`
- `POST /api/admin/reconciliation/alert-action` — `{ alertId, action: RESOLVE|IGNORE }`
- `GET  /health` — public health check

**Audit Logging:** Every POST action writes to `admin_action_logs` with `{ adminId, adminEmail, action, entityId, entityType, payload, ip, timestamp }`.

**New Firestore collections:** `support_tickets`, `disputes`, `admin_action_logs`.
**Files:** `server/index.ts`, `server/firebaseAdmin.ts`, `server/middleware/auth.ts`, `server/middleware/auditLog.ts`, `server/middleware/validate.ts`, `server/routes/payouts.ts`, `server/routes/fraudAlerts.ts`, `server/routes/supportTickets.ts`, `server/routes/disputes.ts`, `server/routes/liquidity.ts`, `server/routes/reconciliation.ts`.
**Config:** `FIREBASE_SERVICE_ACCOUNT` env var (JSON string) required in production; `ADMIN_API_PORT` (default: 4000).

## External Dependencies
- **Firebase:** Authentication, Firestore (database for user data, family features, wallet, campaigns, admin logs, reconciliation, treasury), Firebase Storage (for KYC documents).
- **Expo SDK:** Core framework for React Native development.
- **React Native:** UI framework.
- **React Navigation:** In-app navigation.
- **TanStack React Query:** Data fetching and state management.
- **Chapa API:** Payout connector.
- **Telebirr API:** Payout connector.
- **Ethiopian Bank APIs:** Integration with banks like Dashen, Awash, CBE, Abyssinia for payouts and FX quotes.