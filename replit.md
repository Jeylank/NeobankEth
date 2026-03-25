# Habeshare Mobile App

## Overview
Habeshare is a non-custodial mobile banking application for the Ethiopian diaspora, built with Expo React Native and offering web support. It enables financial services like remittance tracking, bill payments, and KYC verification by acting as an intermediary for transactions processed through licensed Ethiopian financial institutions. The platform aims to simplify financial interactions with Ethiopia, including features such as family support automation, group funding (Family Circle, Support Campaigns), and multi-currency management with transparent FX services. The project's vision is to provide a secure and comprehensive financial bridge to Ethiopia without holding user funds directly.

## User Preferences
I want to interact with you in a clear and concise manner. Prioritize high-level architectural and design decisions over minute implementation details. When proposing changes or explaining concepts, focus on the 'why' before the 'how'. For development tasks, I prefer an iterative approach, with clear checkpoints and opportunities for feedback. Do not introduce new external dependencies or significant architectural changes without prior discussion and approval.

## System Architecture
The application leverages Expo SDK 50, React Native 0.73, React Navigation 6, and TypeScript. Firebase handles authentication and notifications, while TanStack React Query manages data fetching.

**Core Features & Technical Implementations:**
-   **User Authentication & KYC:** Firebase-backed authentication with phone number validation and ID document scanning/upload.
-   **Multi-Language Support:** Internationalization for English, Amharic, Oromo, and Tigrinya.
-   **Non-Custodial Model:** Habeshare intermediates transactions, providing status summaries rather than managing user balances.
-   **Family Support Features:** Includes Family Wallet for tracking monthly support, Family Request for inbound financial requests, Recurring Support Automation for scheduled payments, and Family Circle for group contributions.
-   **Support Campaigns:** Fundraising functionality with contribution tracking and goal management.
-   **Multi-Currency Wallet:** Ledger-based architecture for EUR/USD/GBP, supporting top-ups via Card, Chapa, and Telebirr.
-   **Transparent FX:** Displays live foreign exchange rates from multiple banks, including a rate calculator and quick conversion links.
-   **Notifications System:** In-app and push notifications for various events, with filtering, read/unread states, and navigation to relevant app sections.
-   **Send Again:** Functionality to pre-populate remittance forms from past transactions.
-   **Security:** Features like session management, biometric confirmation, input sanitization, and account masking.
-   **Payout Connectors:** Integration with Chapa, Telebirr, and major Ethiopian banks for transaction processing and tracking.
-   **Admin Operations Console:** A suite of admin screens for monitoring payouts, fraud alerts, support tickets, disputes, liquidity, partner settlements, and reconciliation, with role-based access control.
-   **FX Marketplace:** Compares and selects optimal FX rates from various banks, including quote expiration and liquidity reservation.
-   **Reconciliation Engine:** A system for matching internal transaction records with external settlement reports to identify and alert discrepancies.
-   **Treasury Engine:** Manages liquidity pools, reservations, settlement obligations, and alerts for critical financial thresholds.
-   **Settlement Engine:** Orchestrates settlement processes with services for obligation lifecycle, immutable ledger movements, batch processing, reconciliation, and alerts.
-   **Backend Workers:** Dedicated workers for recurring support automation and settlement processes, including daily batching, reconciliation, and overdue detection.
-   **Advanced Remittance Features:** Includes delivery time estimation, live transfer tracking, rate lock, smart recipient lists, and transfer fee simulation.

**UI/UX:**
-   Consistent design across mobile and web platforms, utilizing custom Ethiopic fonts.
-   Intuitive navigation and clear presentation of financial data, including charts and progress visualizations.
-   Enhanced interactive elements such as `AnimatedPressable`, `SkeletonLoader`, `TrustBadges`, and `SmartEmptyState`.
-   Improved remittance and transfer tracking screens with better visual feedback and user guidance.

**Admin Operations API (Express Server):**
-   A unified Node.js/Express/TypeScript server on **port 5000** serving both the API and the static Expo web app.
-   Workflow: `Admin API` (`npm run server:admin` with `--transpile-only` for fast startup). Single workflow, no separate static server needed.
-   Static files served from `dist/` via `express.static`; SPA catch-all serves `index.html` for non-API paths.
-   Maintenance mode gate applies only to `/api/*` paths — static file serving is never blocked.
-   **Authorization:** Requires valid Firebase ID tokens with admin claims or roles.
-   **Endpoints:** Covers payouts, fraud alerts, support tickets, disputes, liquidity, and reconciliation management.
-   **Audit Logging:** All critical admin actions are logged to `admin_action_logs`.

**Risk Controls Layer:**
-   **Client Integration (COMPLETE):** `src/services/riskControls/clientRiskService.ts` — shared enforcement layer using Firebase client SDK. Integrated into all 6 financial paths: remittance, wallet top-up (TOPUP category), recurring support worker (graceful frozen-user skip), campaign contributions, FX marketplace quote selection, and referral rewards. 30 Jest tests in `server/tests/riskControls.test.ts`. Run: `npm run test:risk`.
-   **Global System Config Service (COMPLETE):** `server/services/systemConfigService.ts` — global emergency kill switch above the per-feature layer. Firestore: `system_config/global`. Controls `systemEnabled`, `payoutEnabled`, `fxMarketplaceEnabled`, `walletEnabled`, `maintenanceMode`. In-memory cache (30 s TTL via `server/utils/cache.ts`). Safe-mode fallback on Firestore failure (all disabled). Integrated into `server/routes/payouts.ts` (systemEnabled + payoutEnabled checks) and `server/index.ts` (global maintenance-mode middleware). Admin endpoints: `GET /api/admin/system-config`, `POST /api/admin/system-config`, `POST /api/admin/system-config/refresh`. All changes write to `admin_action_logs`.
-   **Cache Layer (COMPLETE):** `server/utils/cache.ts` (server) + `src/utils/cache.ts` (client) — type-safe in-memory TTL cache with `get/set/invalidate/invalidatePrefix/stats/flush`. Used for: system config (30 s), FX provider health (15 s), FX quote deduplication (30 s). Cache misses/hits logged at debug level.
-   **Admin Risk Controls Dashboard (COMPLETE):** `src/screens/admin/AdminRiskControlsScreen.tsx` — admin-only screen accessible via the Operations Console. Shows kill switch states with live toggles, blocked transaction metrics (today/7-day) broken down by reason, user status summary (active/frozen/review), and a review queue table with per-user freeze/unfreeze/review/restore-active actions. Each action is confirmed via modal and writes an audit log entry. Fully i18n-compatible (EN/AM/OM/TI). Service methods in `adminService.ts`, new server endpoints: `GET /api/admin/risk-blocked-metrics` and `POST /api/admin/risk-flags/:userId/active`.
-   Integrated backend safety layer with services for:
    -   **Kill Switches:** Temporarily disable platform features (6 kill switches: remittance, topup, recurring_support, campaign_payout, fx_marketplace, referral_rewards).
    -   **Transaction & Velocity Limits:** Configurable limits for transfers and other financial activities.
    -   **Safety Guards:** Pre-flight checks for user status, KYC, liquidity, and repeated failures.
-   **Typed Errors:** Provides structured error responses for specific risk control failures.
-   **Admin Endpoints:** Allows administrators to manage system controls, risk limits, and user risk flags (freeze/unfreeze/review).

**Stripe Payment Integration:**
-   **`server/stripeClient.ts`** — authenticates via Replit Stripe connector (falls back to `STRIPE_SECRET_KEY` env var). Exports `getUncachableStripeClient()` and `getStripeSync()`. On startup, runs `stripe-replit-sync` migrations against PostgreSQL (`DATABASE_URL`) and sets up a managed webhook.
-   **`server/services/stripePaymentService.ts`** — `createPaymentIntent(userId, amount, currency)` creates a Stripe PaymentIntent and writes a `pending` record to Firestore `payment_transactions/{paymentIntentId}`. `handleWebhook(payload, sig)` verifies the Stripe signature, dispatches `payment_intent.succeeded` / `payment_intent.payment_failed`, credits the wallet via a Firestore atomic transaction (same schema as client `walletService`), writes a ledger entry, and marks the transaction `completed`. Full idempotency via pre-check on Firestore status.
-   **`server/middleware/verifyUser.ts`** — Firebase ID token verification for regular (non-admin) users. Attaches `req.userId` and `req.userEmail`.
-   **`server/routes/payments.ts`** — `GET /api/payments/publishable-key` (public, maintenance-bypassed), `POST /api/payments/create-intent` (Firebase auth + system/wallet kill-switch guards), `POST /api/payments/webhook` (Stripe-Signature guard + raw Buffer enforcement).
-   **Webhook registration** in `server/index.ts` uses `express.raw()` **before** `express.json()` to preserve the raw Buffer needed for Stripe signature verification. Maintenance bypass list: `/health`, `/api/payments/webhook`, `/api/payments/publishable-key`.
-   **`src/components/StripePaymentForm.web.tsx`** — Web-only Stripe Elements form (`@stripe/stripe-js` + `@stripe/react-stripe-js`). Fetches publishable key from server, mounts `CardElement`, calls `create-intent` with Firebase ID token, then `stripe.confirmCardPayment`. PCI-compliant — raw card data never touches Habeshare servers.
-   **`src/components/StripePaymentForm.tsx`** — Native stub (pending `@stripe/stripe-react-native` integration).
-   **`src/screens/CardTopUpScreen.tsx`** — Simplified screen with card preview, amount field, and `<StripePaymentForm>` (Expo Metro resolves `.web.tsx` on web). Full real Stripe payment flow — stub removed.
-   **Firestore `payment_transactions`** — fields: `userId`, `amount`, `currency`, `status` (`pending`|`completed`|`failed`), `stripePaymentIntentId`, `createdAt`, `completedAt?`.

## External Dependencies
-   **Firebase:** Authentication, Firestore (database), Firebase Storage (KYC documents).
-   **Expo SDK:** Core framework.
-   **React Native:** UI framework.
-   **React Navigation:** In-app navigation.
-   **TanStack React Query:** Data fetching.
-   **Chapa API:** Payout connector.
-   **Telebirr API:** Payout connector.
-   **Ethiopian Bank APIs:** Integration with banks like Dashen, Awash, CBE, Abyssinia for payouts and FX quotes.