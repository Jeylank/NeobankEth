# Sumsuma Mobile App

## Overview
Sumsuma is a non-custodial mobile banking application for the Ethiopian diaspora, built with Expo React Native, offering web support. It serves as an intermediary for financial services such as remittance tracking, bill payments, and KYC verification, processed through licensed Ethiopian financial institutions. The platform aims to simplify financial interactions with Ethiopia, providing features like family support automation, group funding (Family Circle, Support Campaigns), and multi-currency management with transparent FX services. The project's vision is to establish a secure, comprehensive financial bridge to Ethiopia without directly holding user funds.

## User Preferences
I want to interact with you in a clear and concise manner. Prioritize high-level architectural and design decisions over minute implementation details. When proposing changes or explaining concepts, focus on the 'why' before the 'how'. For development tasks, I prefer an iterative approach, with clear checkpoints and opportunities for feedback. Do not introduce new external dependencies or significant architectural changes without prior discussion and approval.

## System Architecture
The application is built using Expo SDK 50, React Native 0.73, React Navigation 6, and TypeScript. Firebase is used for authentication and notifications, while TanStack React Query handles data fetching.

**Core Features:**
-   **User Management & KYC:** Firebase-backed authentication, phone number validation, and ID document scanning.
-   **Multi-Language Support:** Internationalization for English, Amharic, Oromo, and Tigrinya.
-   **Non-Custodial Financial Model:** Sumsuma intermediates transactions and provides status summaries.
-   **Family Support & Group Funding:** Features like Family Wallet, Family Request, Recurring Support Automation, Family Circle, and Support Campaigns.
-   **Multi-Currency Wallet:** Ledger-based architecture for EUR/USD/GBP, supporting top-ups via Card, Chapa, and Telebirr.
-   **Transparent FX Services:** Displays live foreign exchange rates, rate calculator, and quick conversion.
-   **Notifications:** In-app and push notifications with filtering and navigation.
-   **Advanced Remittance:** "Send Again" functionality, delivery time estimation, live transfer tracking, rate lock, and transfer fee simulation.
-   **Security:** Session management, biometric confirmation, input sanitization, and account masking.
-   **Admin Operations Console:** A suite of admin screens for monitoring payouts, fraud, support, disputes, liquidity, and reconciliation, with role-based access.
-   **Risk Controls Layer:** Client-side and server-side risk enforcement, global kill switches for features, transaction/velocity limits, and safety guards.
-   **Simulation Integration API:** Provides endpoints for wallet top-up, FX quotes, campaign contributions, quote refresh, and transaction resume, with idempotency and self-healing mechanisms. Includes QA lifecycle endpoints: `POST /api/v1/simulation/seed` (pre-funds test wallets — idempotent), `POST /api/v1/simulation/drain` (exhausts all provider pools → PENDING_LIQUIDITY test setup), `POST /api/v1/simulation/reset` (full wipe; accepts `{ seed: true }` to combine reset + fund in one call).
-   **Treasury Router:** Per-provider liquidity pools (sim_provider_liquidity/{stripe|chapa|telebirr}) with ranked provider selection by liquidity→health→cost→delivery. Providers: Stripe 20M ETB, Chapa 15M ETB, Telebirr 15M ETB defaults.
-   **Quote State Machine:** QUOTE_ACTIVE/QUOTE_EXPIRING/PENDING_REQUOTE/REQUOTED/QUOTE_EXPIRED states. Auto-accepts rate changes ≤ 0.5%; requires user confirmation for deltas > 0.5% (PENDING_REQUOTE). QUOTE_EXPIRED always triggers PENDING_REQUOTE — no silent slippage applied, user must acknowledge the fresh rate before funds move.
-   **PENDING_LIQUIDITY Flow:** When all providers exhausted at per-provider level — atomically refunds user wallet + global pool, preserves tx for retry via POST /api/v1/remittance/resume.

**Technical Implementations & Design Choices:**
-   **UI/UX:** Consistent design across mobile and web with custom Ethiopic fonts, intuitive navigation, financial data visualization, and interactive elements like `AnimatedPressable` and `SkeletonLoader`.
-   **Backend Server:** A unified Node.js/Express/TypeScript server (on port 5000) serves both API and the static Expo web app.
-   **Stripe Payment Integration:** Utilizes Stripe Payment Intents for card top-ups, with PCI compliance, webhook handling, and secure client-side integration.
-   **Simulation Engine:** A shared engine for processing remittances and contributions with a 9-step QA-compliant transaction flow and robust error handling.
-   **Caching:** Type-safe in-memory TTL cache used for system config, FX provider health, and FX quote deduplication.
-   **Rate Limiting:** Tiered per-API-key rate limiting on all simulation endpoints: read (120/min), write (30/min), destructive (10/min). Returns 429 with `retryAfterSeconds`. Middleware: `server/middleware/rateLimiter.ts`.
-   **Concurrent Idempotency Safety:** Idempotency key is now read INSIDE the Firestore atomic transaction alongside the wallet and liquidity pool. This prevents the check-then-act race condition — only one concurrent claimant wins; losers replay the winner's result.
-   **Concurrent Load Test:** `server/tests/concurrentLoad.ts` — validates financial invariants under 20 concurrent transactions across 5 users: unique txId guarantee, no double-debit, no wallet overdraw, idempotency under concurrency (10 parallel same-key requests → 1 txId), and rate limiter engagement. Run with `npm run test:load`.
-   **Fraud Detection Engine:** `server/services/fraudEngine.ts` — real-time, rules-based fraud gate that runs BEFORE every wallet debit. Rules: NEW_DEVICE (+20), NEW_RECIPIENT (+15), AMOUNT_ANOMALY (+25), VELOCITY_SPIKE (+30), FAILED_LOGIN_BURST (+20), GEO_MISMATCH (+25). Thresholds: score ≥ 60 → 403 FRAUD_BLOCKED (no debit); score ≥ 30 → 202 PENDING_REVIEW (no debit); else → ALLOW. Device/IP rules use a deviation model: only fire when the user HAS an established history but deviates. Every decision persisted to `fraud_decisions` collection. Integrated into remittance/initiate, campaign/contribute, and recurring/process endpoints. Helpers: `recordTrustedDevice()`, `recordTrustedIp()`, `recordFailedLogin()`. Full wipe on `/simulation/reset`.
-   **Runtime Risk Configuration:** `server/services/riskConfig.ts` — all fraud rule scores, decision thresholds (block/review), and velocity/anomaly limits are runtime-configurable via Firestore (`risk_config/current`). In-memory cache with 60-second TTL; pre-populated with defaults at module load so no Firestore round-trip at startup. `forceInvalidateCache()` resets to defaults on `/simulation/reset`.
-   **Fraud Analytics & Risk Tuning API:** Five endpoints for ops/QA: `GET /api/v1/fraud/decisions` (filterable by userId, decision, since, limit); `GET /api/v1/fraud/stats` (aggregate counts, rates, avg/max score, top rules, unique user counts); `GET /api/v1/risk/config` (read current config + defaults); `PATCH /api/v1/risk/config` (partial update — scores, thresholds, limits; validates block > review); `POST /api/v1/risk/config/reset` (restore factory defaults). Rate-limited: reads at 120/min, writes/destructive at 10/min.

## External Dependencies
-   **Firebase:** Authentication, Firestore (database), Firebase Storage.
-   **Expo SDK:** Core framework for app development.
-   **React Native:** UI framework for mobile applications.
-   **React Navigation:** Navigation library.
-   **TanStack React Query:** Data fetching and state management.
-   **Chapa API:** Payout connector.
-   **Telebirr API:** Payout connector.
-   **Ethiopian Bank APIs:** Integration with major Ethiopian banks (e.g., Dashen, Awash, CBE, Abyssinia) for payouts and FX quotes.
-   **Stripe:** Payment gateway for card top-ups.