# Remaining Closed-Beta Admin Gap Report

Reviewed: 2026-07-10

Scope: current Admin Console, admin backend, tests, deployment configuration, and operational documentation. This is a gap report only; no feature or remittance financial-logic changes are included.

## Executive assessment

The automated suite covers core admin authorization, route registration, transfer operations, notification read behavior, and Beta Risk partial-source resilience. The Admin Console is **not yet ready to operate a closed beta** until the critical credential, refund-eligibility, and risk-counter gaps below are resolved and verified in the beta environment.

Recommended order is expressed as `P0`, `P1`, and so on. Lower numbers should be completed first.

## 1. Admin Transfers

| Order | Gap | Severity | Blocks closed beta | Exact route/screen/file | Minimal implementation needed |
|---|---|---|---|---|---|
| P1 | Paid-out or completed transfers can be presented as refund-eligible. `refundEligible` checks payment/reservation state but does not exclude `PAID_OUT` or `COMPLETED`; the existing refund service can consequently credit a captured debit after payout. This conflicts with the documented rule that paid-out transfers must never be automatically refunded. | critical | yes | `POST /api/admin/transfers/:txId/refund`; `server/services/adminTransfersService.ts` (`paymentConfirmation.refundEligible`, `initiatePermittedRefund`); `server/services/paymentConfirmationService.ts` (`refundSimulationPayment`); `src/screens/admin/AdminTransfersScreen.tsx`; `docs/closed-beta-readiness.md` | Define and enforce one authoritative permitted-refund state policy before invoking the existing refund operation; explicitly reject paid-out/completed transfers, test every terminal state, and keep duplicate refunds idempotent. |
| P5 | Recovery and refund admin actions are not written to the immutable admin audit feed with admin identity, reason, before/after state, and result. | high | yes | `POST /api/admin/transfers/:txId/recovery`; `POST /api/admin/transfers/:txId/refund`; `server/routes/adminTransfers.ts`; `server/services/auditLogService.ts` | Require a short reason and write success/failure audit records containing admin ID, transfer ID, previous state, resulting state, and idempotency outcome. |
| P12 | Operational detail joins fail open to empty arrays. Firestore failures for ledger, assignment, OTP state, reconciliation, or alerts are indistinguishable from “no data.” | high | no, if operators use direct reconciliation checks and the UI clearly remains advisory | `GET /api/admin/transfers/:txId`; `server/services/adminTransfersService.ts`; `src/screens/admin/AdminTransfersScreen.tsx` | Return per-section availability/error metadata and render “unavailable” separately from “none.” Do not expose raw exceptions. |
| P15 | Transfer detail has no reason input or operator-facing action result history. Generic success dialogs do not show whether an operation was a duplicate/no-op. | medium | no | `src/screens/admin/AdminTransfersScreen.tsx`; `src/services/adminService.ts` | Display the structured action result, including duplicate/idempotent status, and collect a reason for audited writes. |
| P18 | Transfer detail coverage is mostly route mocks and source-contract assertions, not Firestore-backed integration for ledger, assignment, OTP redaction, reconciliation, and alerts. | medium | no, if manual QA and emulator certification are completed | `server/tests/adminRoutes.test.ts`; `server/tests/adminFrontendContracts.test.ts`; missing service/emulator tests for `server/services/adminTransfersService.ts` | Add emulator-gated fixtures that assert complete detail shape and prove OTP/hash/token fields never leave the service. |

## 2. Admin Users

| Order | Gap | Severity | Blocks closed beta | Exact route/screen/file | Minimal implementation needed |
|---|---|---|---|---|---|
| P9 | The Admin Users module has no suspend/reactivate action. Risk freeze/restore exists elsewhere, but account suspension is not available or clearly distinguished from risk state. | high | no, provided the documented risk-freeze procedure is tested and staffed | `src/screens/admin/AdminUsersScreen.tsx`; `server/routes/adminUsers.ts`; existing alternatives in `server/routes/adminRiskControls.ts` | Either expose confirmed, audited suspend/reactivate actions using Firebase Auth disabled state, or document and link the existing risk freeze/restore procedure as the closed-beta control. |
| P13 | Admin promotion/demotion/bootstrap errors return raw exception messages; bootstrap has no rate limiter and remains enabled whenever the shared secret is configured. | high | yes if bootstrap is enabled in the beta deployment | `POST /api/admin/users/bootstrap`, `/users/promote`, `/users/demote`; `server/routes/adminUsers.ts` | Disable/remove bootstrap after first-admin creation, add strict rate limiting, validate IDs/email, preserve safe error bodies, and audit bootstrap attempts without recording the secret. |
| P16 | User detail includes KYC full name, phone, balances, and risk reason without field-level role separation or an explicit access-purpose audit event. | medium | no for a very small named admin cohort | `GET /api/admin/users/:uid/detail`; `server/services/adminUsersService.ts`; `src/screens/admin/AdminUsersScreen.tsx` | Restrict access to named operations roles, audit detail views, document privacy purpose/retention, and mask fields not required for support. |
| P20 | Search without a query returns only one Firebase Auth page, while query search scans at most 5,000 users; totals are scan counts rather than reliable result totals. | medium | no at a small beta cohort | `GET /api/admin/users`; `server/services/adminUsersService.ts`; `src/screens/admin/AdminUsersScreen.tsx` | Add cursor-based Auth pagination and explicit `nextPageToken`/`hasMore`; document the closed-beta cohort limit until then. |

## 3. Audit Logs

| Order | Gap | Severity | Blocks closed beta | Exact route/screen/file | Minimal implementation needed |
|---|---|---|---|---|---|
| P6 | The unified audit feed is assembled from mutable operational collections and is not cryptographically or rules-enforced immutable. `firebase.json` does not load `firestore.rules` in emulator tests. | high | yes for financial admin writes | `GET /api/admin/audit-logs`; `server/services/auditLogService.ts`; `firestore.rules`; `firebase.json` | Store admin actions in an append-only collection, deny client update/delete in rules, configure emulator rules, and test immutability. |
| P7 | Important admin transfer recovery/refund actions are absent from the audit feed. Other admin modules also return inconsistent audit coverage. | high | yes | `server/routes/adminTransfers.ts`; `server/routes/adminRiskControls.ts`; `server/routes/reconciliation.ts`; `server/services/auditLogService.ts` | Define a required admin-event matrix and ensure every write records actor, target, reason, request/result IDs, old/new state, and timestamp. |
| P21 | Audit log pagination is only a bounded `limit`; there is no stable cursor, total, or continuation token. | medium | no at low volume | `GET /api/admin/audit-logs`; `server/services/auditLogService.ts`; `src/screens/admin/AdminAuditLogsScreen.tsx` | Add stable `(timestamp,id)` cursor pagination and UI load-more behavior. |
| P24 | Invalid event types are silently discarded rather than rejected, which can make an operator believe a requested filter returned no events. | low | no | `server/routes/auditLogs.ts` | Return `400 INVALID_EVENT_TYPE` listing supported values when any requested type is invalid. |

## 4. Beta Risk Summary

| Order | Gap | Severity | Blocks closed beta | Exact route/screen/file | Minimal implementation needed |
|---|---|---|---|---|---|
| P2 | Fraud counters query `PENDING_REVIEW` and `BLOCKED`, while the active fraud engine persists `REVIEW` and `BLOCK`. Pending-review and blocked counts can therefore report zero incorrectly. | critical | yes | `GET /api/admin/dashboard/beta-risk-summary`; `server/services/betaRiskSummaryService.ts` (`countFraud`); `server/services/fraudEngine.ts` | Align summary queries with the canonical fraud decision enum and add fixtures proving ALLOW/REVIEW/BLOCK counts. |
| P3 | Partial data-source failures are converted to zero/empty values without identifying which source failed. A degraded dashboard may look healthy and understate exposure, fraud, KYC, or alerts. | critical | yes | `GET /api/admin/dashboard/beta-risk-summary`; `server/services/betaRiskSummaryService.ts`; `src/screens/admin/AdminBetaRiskSummaryScreen.tsx` | Add `sources` health/staleness metadata, set overall health to degraded when any source falls back, and render unavailable metrics rather than zero. |
| P14 | Total/active user counting scans Firebase Auth up to 5,000 users and defines “active today” by UTC day boundary, which is not documented in the UI. | medium | no at a small beta cohort | `server/services/betaRiskSummaryService.ts` (`countUsers`); `src/screens/admin/AdminBetaRiskSummaryScreen.tsx` | Expose truncation and timezone metadata; later replace scans with maintained aggregates. |
| P17 | Summary refresh is client-side only. There is no server-side freshness SLA, last-success timestamp per source, or stale-data alert. | medium | no with continuous staffed monitoring | `src/screens/admin/AdminBetaRiskSummaryScreen.tsx`; `server/services/betaRiskSummaryService.ts` | Return per-source collected-at timestamps and flag metrics stale after a documented threshold. |

## 5. Notifications

| Order | Gap | Severity | Blocks closed beta | Exact route/screen/file | Minimal implementation needed |
|---|---|---|---|---|---|
| P10 | “Mark all read” processes only the first 100 notifications, and list/unread count returns only the first 50. The API can report `unreadCount: 0` while older unread records remain. | high | no for a new low-volume cohort | `GET /api/notifications`; `POST /api/notifications/read-all`; `server/routes/notifications.ts`; `src/hooks/useUnreadNotifications.ts` | Paginate/batch until all unread records are updated, or maintain an authoritative per-user unread counter. Return `hasMore` when bounded. |
| P19 | Admin risk alerts are dashboard records, not targeted in-app admin notifications. There is no guaranteed unread admin alert badge or acknowledgement lifecycle tied to Beta Risk alerts. | medium | no with the dashboard open and staffed | `server/services/betaRiskService.ts`; `server/services/dashboardService.ts`; `src/screens/admin/AdminBetaRiskSummaryScreen.tsx`; `src/screens/NotificationsScreen.tsx` | Decide whether operational alerts belong in notifications; if so, create in-app-only admin recipients, deduplicate by alert ID, and link acknowledgement state. |
| P25 | The application still initializes Expo push infrastructure outside the admin work, so “in-app only” depends on deployment configuration rather than an explicit closed-beta feature flag. | low | no if push credentials/tokens are disabled and verified | `src/components/ConfiguredApp.tsx`; `src/services/pushNotifications.ts` | Document and verify push is disabled for the beta admin cohort, or gate initialization behind an explicit configuration flag. |

## 6. Pagination/search/filtering

| Order | Gap | Severity | Blocks closed beta | Exact route/screen/file | Minimal implementation needed |
|---|---|---|---|---|---|
| P11 | Transfers have no cursor pagination and scan up to 500 records in memory. Operators cannot reliably reach older transfers. | high | no for a tightly bounded cohort; yes once volume can exceed the scan window | `GET /api/admin/transfers`; `server/services/adminTransfersService.ts`; `src/screens/admin/AdminTransfersScreen.tsx` | Add stable cursor pagination, `hasMore`, and load-more controls. |
| P22 | Transfer filters remain limited to status. Payout method, date range, fraud decision, KYC status, and reference-specific filtering are absent. | medium | no if the cohort is small enough for ID/user search | Same transfer route/service/screen as above | Add validated filter parameters and indexed Firestore query plans; retain bounded fallback only for closed-beta free text. |
| P23 | Transfer free-text search omits common reference fields and only searches the bounded recent snapshot. | medium | no | `server/services/adminTransfersService.ts` (`searchTransfers`) | Normalize/index searchable transfer ID, sender UID, recipient ID/name, and reference; document exact-match versus contains behavior. |
| P26 | Admin Users and Audit Logs also lack cursor pagination; screens hard-code 50 and 150 row limits. | low | no at closed-beta volumes | `src/screens/admin/AdminUsersScreen.tsx`; `src/screens/admin/AdminAuditLogsScreen.tsx`; corresponding routes/services | Add cursor contracts consistently across all three modules after transfer pagination. |

## 7. Security and authorization

| Order | Gap | Severity | Blocks closed beta | Exact route/screen/file | Minimal implementation needed |
|---|---|---|---|---|---|
| P0 | A live-looking simulation API key is committed in `.replit`, including as `EXPO_PUBLIC_API_KEY`, which places it in the client-visible environment. That key can access destructive simulation and payout endpoints. | critical | yes | `.replit` lines defining `EXPO_PUBLIC_API_KEY` and `SIMULATION_API_KEY`; `server/routes/simulation.ts`; `server/routes/agentPayout.ts` | Revoke/rotate the key, remove it from tracked/client-visible configuration and history as required, store the replacement only in the deployment secret manager, and verify destructive endpoints reject the old key. |
| P4 | Sensitive admin reads for transfers, users, dashboard, and audit logs accept the shared simulation API key. Compromise grants broad PII and operational visibility without actor identity. | critical | yes | `server/routes/adminTransfers.ts`, `adminUsers.ts`, `dashboard.ts`, `auditLogs.ts` (`requireAdminOrApiKey`) | Require Firebase admin identity for all `/api/admin/*` routes. Keep API-key QA access on isolated simulation endpoints with non-production data only. |
| P8 | Many older admin modules omit rate limit middleware and return raw exception messages/details. The Firebase admin middleware itself returns `err.message` in a 401 detail. | high | yes for an internet-accessible beta | `server/middleware/auth.ts`; `server/routes/adminRiskControls.ts`, `reconciliation.ts`, `fraudAlerts.ts`, `disputes.ts`, `payouts.ts`, `liquidity.ts`, `supportTickets.ts`, `systemConfigRoutes.ts`, and admin-user write routes | Apply shared read/write/destructive limiters, centralized validation, and a generic structured error handler across all admin routes; log only redacted correlation IDs. |
| P13 | Initial-admin bootstrap relies on a shared secret and has no attempt limiter; see Admin Users. | high | yes if enabled | `POST /api/admin/users/bootstrap`; `server/routes/adminUsers.ts` | Disable after bootstrap and add rate limiting/audit controls before any exposure. |
| P27 | CORS defaults to `*` when `ALLOWED_ORIGIN` is missing. | medium | yes if deployment configuration is not verified | `server/index.ts` | Fail startup in beta/production when an explicit allowed origin is absent; verify web and mobile API behavior. |
| P28 | Admin authorization has only a boolean claim/role; there is no separation between read-only support, risk operations, refunds, and configuration administration. | medium | no for a very small named operations team | `server/middleware/auth.ts`; all `/api/admin/*` write routes | Define minimal roles/scopes and require stronger privileges for refunds, risk controls, promotion, and configuration changes. |

## 8. Monitoring and operational runbooks

| Order | Gap | Severity | Blocks closed beta | Exact route/screen/file | Minimal implementation needed |
|---|---|---|---|---|---|
| P29 | Reconciliation has no verified monitored production scheduler; the runbook requires an operator to invoke it every five minutes. | high | no only for a strictly staffed beta window | `docs/closed-beta-readiness.md`; `POST /api/v1/remittance/reconcile`; `server/services/remittanceReconciliationService.ts` | Assign named coverage and an invocation log for closed beta; before unattended operation, deploy a scheduled job with retries, lock/idempotency, and failure alerting. |
| P30 | Alerts are database/UI-only and do not guarantee operator paging. | high | no only while an operator continuously watches the dashboard | `server/services/betaRiskService.ts`; `src/screens/admin/AdminBetaRiskSummaryScreen.tsx`; `docs/closed-beta-readiness.md` | Document dashboard-watch ownership, escalation time, and backup operator. Add external paging before unattended operation. |
| P31 | The runbook is stale: it was reviewed before current admin changes and emphasizes `/api/v1/admin/*` API-key operations rather than the new Admin Console routes/actions. | high | yes until operators rehearse an accurate procedure | `docs/closed-beta-readiness.md` | Update route/auth instructions, refund/recovery eligibility, screenshots/expected responses, incident evidence, and rollback contacts; conduct a tabletop exercise. |
| P32 | No tested backup/restore, point-in-time recovery, post-restore reconciliation, or disaster-recovery evidence is present. | high | yes for any beta holding durable financial state | `docs/closed-beta-readiness.md`; no dedicated backup/restore runbook found | Create and execute a beta-project backup/restore drill, then reconcile wallets, reservations, transfers, ledger, and agent float after restore. |
| P36 | No documented metrics/SLOs for admin API availability, dashboard freshness, reconciliation lag, stuck transfers, or failed admin actions. | medium | no with manual supervision | No dedicated monitoring/runbook file found; `src/screens/admin/AdminSystemMonitorScreen.tsx` | Define thresholds, owners, alert channels, and daily evidence retention. |

## 9. Browser/mobile manual QA

| Order | Gap | Severity | Blocks closed beta | Exact route/screen/file | Minimal implementation needed |
|---|---|---|---|---|---|
| P33 | Admin navigation/deep-link tests are source-contract assertions, not real browser tests. Refreshing a deployed deep link, auth redirect/back behavior, and static SPA fallback are not certified. | high | yes for web-admin beta operation | `src/components/ConfiguredApp.tsx`; `src/navigation/RootNavigator.tsx`; `server/tests/adminFrontendContracts.test.ts`; `server/index.ts` SPA fallback | Manually test every scoped deep link in the deployed web build with admin/non-admin sessions, refresh, back/forward, expired token, and 401/403 handling; record evidence. |
| P34 | Transfer write confirmation and detail rendering have not been exercised on physical mobile devices or multiple browser sizes/accessibility settings. | medium | no if web is the sole declared admin surface | `src/screens/admin/AdminTransfersScreen.tsx`; `AdminUsersScreen.tsx`; `AdminAuditLogsScreen.tsx`; `AdminBetaRiskSummaryScreen.tsx` | Run a manual matrix covering iOS/Android/web, narrow/wide viewport, slow network, offline/reconnect, double taps, screen reader labels, and long identifiers/messages. |
| P35 | Notification optimistic badge behavior is unit/contract tested but not manually verified across two tabs/devices and network failure. | medium | no | `src/hooks/useUnreadNotifications.ts`; `src/screens/NotificationsScreen.tsx`; `src/services/firestoreNotifications.ts` | Verify single-read/read-all, concurrent sessions, more than 100 notifications, failed API response, and Firestore reconnect behavior. |

## 10. Production deployment readiness

| Order | Gap | Severity | Blocks closed beta | Exact route/screen/file | Minimal implementation needed |
|---|---|---|---|---|---|
| P0 | Tracked/client-exposed simulation credential; see Security and authorization. | critical | yes | `.replit` | Rotate and move to managed secrets before deployment. |
| P37 | Firestore emulator configuration does not reference `firestore.rules`, so rule enforcement is not part of the standard emulator gate. | high | yes | `firebase.json`; `firestore.rules`; `scripts/runFirestoreEmulatorTests.js` | Configure rules in `firebase.json`, run rules-aware emulator tests, and prove admin/audit/notification data boundaries. |
| P38 | No CI workflow or release gate was found for tests, typecheck, web build, dependency audit, secret scanning, or emulator tests. | high | yes unless a documented manual release approver performs every gate | No `.github` workflow found; `package.json` | Add or document an equivalent release pipeline that runs tests, typecheck, build, emulator suite, secret scan, and deployment approval on the exact release commit. |
| P39 | Deployment starts the TypeScript server with `ts-node --transpile-only`; runtime startup does not enforce type safety, and there is no explicit production artifact/health rollout check. | medium | no if typecheck is a mandatory release gate | `.replit`; `package.json` (`server:admin`); `server/index.ts` | Build server JavaScript as a release artifact, start that artifact, and add deployment health/readiness checks plus rollback criteria. |
| P40 | Production-provider, webhook, refund, chargeback, and reconciliation certification remains incomplete; existing readiness documentation explicitly limits confidence to simulation-funded beta. | critical for real money | yes for any real-money beta; no for simulation-funded beta | `docs/closed-beta-readiness.md`; `server/routes/payments.ts`; `server/services/stripePaymentService.ts`; production remittance provider files | Keep closed beta simulation-funded, or complete provider sandbox certification and accounting/reconciliation evidence before processing real money. |
| P41 | Exposure is neither atomically claimed nor currency-normalized. | critical for real money | yes for multi-currency or materially concurrent real-money beta; no only under the documented single-currency, low-concurrency simulation constraint | `docs/closed-beta-readiness.md`; beta limit services | Maintain the documented single-currency supervised restriction; implement transactional exposure reservations and base-currency normalization before broader operation. |

## Recommended execution sequence

1. **P0:** Rotate/remove the tracked client-visible simulation key and verify revocation.
2. **P1:** Prevent paid-out/completed refunds and certify every refund state/idempotency case.
3. **P2–P3:** Correct fraud decision counters and expose partial-source degradation explicitly.
4. **P4:** Remove shared API-key access from sensitive `/api/admin/*` reads.
5. **P5–P8:** Make every admin write auditable/immutable, configure rules tests, and standardize rate limits/errors.
6. **P13/P27:** Disable bootstrap and enforce explicit CORS before exposure.
7. **P31–P33/P37–P38:** Update/rehearse the runbook, test restore, complete deployed browser QA, enable rules-aware emulator and release gates.
8. **P9–P12:** Close user operations, notification bounds, transfer pagination, and detail availability semantics.
9. **P14 onward:** Address scale, usability, role separation, monitoring maturity, and production-provider readiness.

## Verification status

The final automated verification results for this review are recorded below after running the required commands on the current working tree.

- `npm.cmd test`: **PASS** — 16 suites passed, 1 emulator-gated suite skipped; 159 tests passed, 14 skipped, 173 total.
- `npm.cmd run typecheck`: **PASS** — TypeScript completed with no errors.
