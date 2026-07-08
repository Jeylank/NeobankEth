# Closed-Beta Readiness Report

Last reviewed: 2026-07-06

## Readiness assessment

The current system is suitable for a tightly supervised, simulation-funded closed beta after the operating checklist below is completed. It is **not ready for unsupervised real-money production use**. The primary blockers are listed under Remaining production gaps and Go/no-go criteria.

## 1. Current implemented safety controls

### Transfer and payment controls

- New remittances start in `PAYMENT_PENDING`; payout does not begin before payment confirmation.
- Initiation reserves wallet funds without permanently debiting them.
- Successful payment confirmation converts the reservation into one wallet debit.
- Failed payment releases the reservation.
- Duplicate initiation and payment confirmation are idempotent.
- `agent_cash` payout requires assignment, OTP verification, and a single-use payout token.
- Duplicate cash payout is blocked and cannot reduce agent float twice.
- Refunds reverse either an active reservation or a captured debit once.
- Paid-out transfers are not automatically refunded by reconciliation.

### Closed-beta limits

The persisted `beta_controls/current` configuration supports:

- Maximum amount per transfer.
- Maximum daily transfer count per user.
- Maximum daily transfer volume per user.
- Maximum total active platform exposure.
- A global beta pause that blocks new initiation.

Default values:

| Control | Default |
|---|---:|
| Maximum transfer amount | 1,000 |
| Maximum daily transfers per user | 10 |
| Maximum daily volume per user | 5,000 |
| Maximum total platform exposure | 100,000 |
| New-transfer pause | Off |

Limits currently operate on numeric source amounts. Use one beta source currency until currency-normalized exposure is implemented.

### Recovery and reconciliation

`POST /api/v1/remittance/reconcile` checks:

- Wallet reservations against active transfer reservations.
- Debit and credit balance across ledger journals per transfer.
- Agent float changes against agent payout journals.
- `PAYMENT_PENDING` transfers older than the configured threshold.
- `FUNDS_RECEIVED` and `OTP_SENT` transfers beyond their SLA.

Recovery behavior:

- Stale `PAYMENT_PENDING` transfers become `PAYMENT_EXPIRED`, and their reservation is released atomically.
- Stuck agent-cash transfers become `RECOVERY_PENDING` for manual handling.
- Recovery ledger IDs are deterministic, preventing duplicate entries across repeated runs.
- `PAID_OUT` transfers are not automatically refunded.

### Risk alerts

The `beta_risk_alerts` collection receives idempotent alert events for:

- `DUPLICATE_REQUEST`
- `FAILED_PAYMENT`
- `STUCK_RECOVERY`
- `LOW_AGENT_FLOAT`
- `LEDGER_IMBALANCE`

### Mobile safety

- Mobile initiation uses `POST /api/v1/remittance/initiate`.
- Mobile payment confirmation uses `POST /api/v1/remittance/confirm-payment`.
- Backend failures remain failures; the main mobile flow cannot create a synthetic successful transfer in Firestore or AsyncStorage.
- Mobile status handling includes `PAYMENT_PENDING`, `FUNDS_RECEIVED`, `OTP_SENT`, `READY_FOR_PAYOUT`, and `RECOVERY_PENDING`.

## 2. Remaining production gaps

These gaps must not be treated as covered by the closed-beta controls:

1. **Admin authentication inconsistency.** The beta summary and beta-control routes currently use `SIMULATION_API_KEY`, while other admin routes use Firebase `verifyAdmin`. Do not expose these endpoints publicly. Migrating them to Firebase admin authorization is required before production.
2. **Exposure enforcement is not an atomic capacity claim.** The limit check reads existing transfers before initiation. Concurrent requests can pass the same remaining-exposure check. A transactional exposure counter or reservation is required for production.
3. **Exposure is not currency normalized.** EUR, USD, GBP, and other source amounts are added directly. Closed beta must use one source currency or very conservative limits until exposure is converted to a base currency.
4. **Production-provider accounting is incomplete.** The simulation path has the strongest reservation, ledger, reconciliation, and recovery coverage. Equivalent guarantees must be verified for every real payment and payout provider.
5. **No automatic scheduler is shown for reconciliation.** Operations must invoke reconciliation on a fixed cadence until a monitored scheduled job with retry and alerting exists.
6. **Alert delivery is database-only.** Alerts are persisted but are not guaranteed to page an operator through SMS, email, PagerDuty, or another external channel.
7. **No four-eyes approval for limit and pause changes.** One API-key holder can change beta controls. Production needs authenticated identity, audit history, and preferably dual approval for material changes.
8. **Provider webhook and refund certification remains required.** Test real provider timeout, duplicate webhook, partial failure, refund, and chargeback scenarios in provider sandboxes.
9. **Firestore rules are not exercised by the emulator command.** The current emulator warns that it defaults to allowing reads and writes because no rules file is configured in `firebase.json`.
10. **Operational retention and privacy controls require review.** Confirm retention, access control, redaction, and deletion policy for OTP, payment, audit, and alert records.
11. **Secondary mobile workflows need end-to-end certification.** Family, recurring, campaign, and request flows use the shared API schema but require explicit confirmation that they do not treat `PAYMENT_PENDING` as completed.
12. **Disaster recovery is unproven.** Firestore backup, restore, point-in-time recovery, and reconciliation after restore need a tested runbook.

## 3. Required environment variables

Never commit real values. Store server secrets in the deployment secret manager and expose only `EXPO_PUBLIC_*` values to the mobile bundle.

### Required for the mobile application

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_API_URL` | Backend base URL. |
| `EXPO_PUBLIC_FIREBASE_API_KEY` | Firebase client API key. |
| `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase Auth domain. |
| `EXPO_PUBLIC_FIREBASE_PROJECT_ID` | Firebase project ID; also used by server initialization when present. |
| `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` | Firebase Storage bucket. |
| `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID. |
| `EXPO_PUBLIC_FIREBASE_APP_ID` | Firebase application ID. |

### Required for the backend beta environment

| Variable | Purpose |
|---|---|
| `APP_MODE` | Set explicitly to `simulation` for simulation beta or `production` only after production approval. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Preferred Replit Secret: JSON service-account credentials for Firebase Admin. Store as one line, with private key newlines escaped as `\n`. |
| `FIREBASE_SERVICE_ACCOUNT` | Backward-compatible alias for JSON service-account credentials. |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | Multiline-safe alternative: base64-encoded service-account JSON. |
| `EXPO_PUBLIC_FIREBASE_PROJECT_ID` | Firebase Admin project selection. |
| `SIMULATION_API_KEY` | Protects simulation, payout, reconciliation, and beta-admin endpoints. Must be long, random, and rotated. |
| `ADMIN_BOOTSTRAP_SECRET` | Protects initial admin bootstrap. Remove or rotate after bootstrap. |
| `ALLOWED_ORIGIN` | Explicit allowed frontend origin; do not use `*` for an internet-accessible beta. |
| `ADMIN_API_PORT` | Optional; defaults to `5000`. |

### Required only for real Stripe/payment operation

| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe server secret key. |
| `STRIPE_PUBLISHABLE_KEY` | Stripe client publishable key. |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature verification. |
| `DATABASE_URL` | Stripe synchronization database. |

Replit connector deployments may additionally use `REPLIT_CONNECTORS_HOSTNAME`, `REPL_IDENTITY`, `WEB_REPL_RENEWAL`, `REPLIT_DEPLOYMENT`, and `REPLIT_DOMAINS`.

### Test-only variables

| Variable | Purpose |
|---|---|
| `FIRESTORE_EMULATOR_HOST` | Firestore emulator address, normally `127.0.0.1:8080`. |
| `RUN_FIRESTORE_EMULATOR_TESTS=1` | Explicitly enables emulator integration tests. |

## 4. Manual beta operating checklist

### Before opening each beta window

- [ ] Confirm `APP_MODE` is the intended mode.
- [ ] Confirm Firebase project and service account point to the beta project, not production.
- [ ] Confirm `ALLOWED_ORIGIN` is restricted.
- [ ] Rotate and distribute `SIMULATION_API_KEY` through an approved secret channel.
- [ ] Verify the beta pause is on while checks are performed.
- [ ] Review and set all four beta limits for the day's expected cohort and currency.
- [ ] Confirm beta users and agents are allowlisted through the operational process.
- [ ] Confirm each online agent's identity, city, status, and available float.
- [ ] Run `npm test`, `npm run test:emulator`, and `npm run typecheck`.
- [ ] Call reconciliation and resolve all critical findings.
- [ ] Confirm platform exposure, active transfers, low-float agents, and open alerts from the beta summary.
- [ ] Test one low-value transfer through initiation, confirmation, OTP, and payout.
- [ ] Test one failed payment and verify reservation release.
- [ ] Confirm an operator is assigned to monitor throughout the window.
- [ ] Turn the beta pause off only after the go criteria are satisfied.

### During operation

- [ ] Monitor the beta risk summary at least every 15 minutes.
- [ ] Run reconciliation at least every 5 minutes until scheduling is implemented.
- [ ] Investigate every `LEDGER_IMBALANCE`, `STUCK_RECOVERY`, and `FAILED_PAYMENT` alert.
- [ ] Pause before exposure remaining reaches the largest permitted transfer.
- [ ] Replenish or disable low-float agents.
- [ ] Do not manually edit wallet, ledger, reservation, transaction, or agent-float documents.
- [ ] Record incident timestamps, transaction IDs, actions, and operator identity.

### At beta-window close

- [ ] Pause new transfers.
- [ ] Allow existing transfers to finish, recover, reconcile, or refund.
- [ ] Run reconciliation until there are no unexplained findings.
- [ ] Verify every wallet reservation maps to an active transfer.
- [ ] Verify every ledger imbalance has an incident record and resolution.
- [ ] Export the risk summary and open-alert list for the daily report.
- [ ] Reconcile provider reports and actual cash/settlement positions.

## 5. Admin dashboard fields

`GET /api/v1/admin/beta-risk-summary` returns:

| Field | Meaning |
|---|---|
| `paused` | Whether new beta transfer initiation is paused. |
| `limits.maxTransferAmount` | Maximum permitted amount for one transfer. |
| `limits.maxDailyTransfersPerUser` | Maximum daily initiated transfers per user. |
| `limits.maxDailyVolumePerUser` | Maximum daily source volume per user. |
| `limits.maxTotalPlatformExposure` | Maximum active platform exposure. |
| `exposure` | Current non-terminal transfer exposure. |
| `exposureRemaining` | Remaining capacity before the exposure limit. |
| `activeTransfers` | Number of non-terminal transfers. |
| `lowFloatAgents` | Agents with available float below 500. |
| `openAlerts` | Number of open beta risk alerts. |
| `alertsByType` | Open alert counts grouped by type. |
| `generatedAt` | Summary generation timestamp. |

Operational controls:

```http
POST /api/v1/admin/beta-controls
X-API-Key: <SIMULATION_API_KEY>
Content-Type: application/json

{
  "paused": true,
  "updatedBy": "operator-id"
}
```

Limit changes use the same endpoint with a `limits` object. Always read the summary after a change and record the response.

## 6. Go/no-go criteria

### Go for a supervised simulation-funded beta only when

- All automated tests and typecheck pass on the release commit.
- New-transfer pause and all beta limits have been verified.
- The beta uses a single source currency.
- No open `LEDGER_IMBALANCE` alerts exist.
- No unexplained wallet reservation mismatch or agent-float mismatch exists.
- Platform exposure is below 50% of its configured maximum at opening.
- Every active agent is verified and has sufficient float.
- A named operator can pause within five minutes and monitor continuously.
- Reconciliation and refund procedures have been exercised in the beta environment.
- Firebase backups and an incident log location are confirmed.

### No-go or immediate pause when

- Any ledger imbalance is unexplained.
- Wallet balances, reservations, provider records, or agent float cannot be reconciled.
- Exposure is calculated across multiple currencies without normalization.
- Exposure remaining is below the maximum single-transfer limit.
- Reconciliation cannot complete or Firestore is unavailable.
- Admin credentials or `SIMULATION_API_KEY` may be compromised.
- Duplicate payouts, duplicate debits, or unauthorized transfers are suspected.
- Failed payments retain reservations beyond the recovery threshold.
- No operator is actively monitoring.
- The deployment is intended to move real money while any production gap above remains unresolved.

## 7. Emergency pause and refund procedure

### A. Pause new transfers

1. Set the beta pause:

   ```http
   POST /api/v1/admin/beta-controls
   X-API-Key: <SIMULATION_API_KEY>
   Content-Type: application/json

   { "paused": true, "updatedBy": "operator-id" }
   ```

2. Verify `paused: true` through `GET /api/v1/admin/beta-risk-summary`.
3. Attempt a low-value initiation and confirm it returns `BETA_PAUSED`.
4. Do **not** enable global maintenance mode unless necessary: beta pause intentionally leaves confirmation, reconciliation, recovery, and refund available.

### B. Assess and recover

1. Capture the risk summary and incident start time.
2. Run:

   ```http
   POST /api/v1/remittance/reconcile
   X-API-Key: <SIMULATION_API_KEY>
   Content-Type: application/json

   { "recover": true }
   ```

3. Review every returned issue and action.
4. Confirm stale payment reservations were released once.
5. Treat `RECOVERY_PENDING` as manual review; do not directly change it to paid or refunded.
6. Confirm paid-out transfers remain `PAID_OUT`.

### C. Refund an eligible transfer

1. Verify the transfer ID, user, amount, currency, payment state, payout state, and ledger journals.
2. Never use automatic refund for a transfer already paid to an agent or recipient.
3. For an eligible simulation transfer, call:

   ```http
   POST /api/v1/remittance/refund
   X-API-Key: <SIMULATION_API_KEY>
   Content-Type: application/json

   { "transactionId": "tx_..." }
   ```

4. Repeat the request once only as an idempotency check; it must not create another credit or ledger journal.
5. Run reconciliation again.
6. Verify wallet balance, reservation balance, transfer status, and ledger balance.
7. Record the operator, reason, transaction ID, API response, and reconciliation result.

### D. Resume

Resume only after the incident owner confirms:

- Root cause is understood and contained.
- Reconciliation has no unexplained financial findings.
- Exposure and agent float are safe.
- Required refunds are complete and balanced.
- Monitoring is staffed.

Set `paused` to `false`, verify the summary, then process one low-value canary transfer before reopening the cohort.
