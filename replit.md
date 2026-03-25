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
-   A standalone Node.js/Express/TypeScript server providing API endpoints for admin functions.
-   **Authorization:** Requires valid Firebase ID tokens with admin claims or roles.
-   **Endpoints:** Covers payouts, fraud alerts, support tickets, disputes, liquidity, and reconciliation management.
-   **Audit Logging:** All critical admin actions are logged to `admin_action_logs`.

**Risk Controls Layer:**
-   **Client Integration (COMPLETE):** `src/services/riskControls/clientRiskService.ts` — shared enforcement layer using Firebase client SDK. Integrated into all 6 financial paths: remittance, wallet top-up (TOPUP category), recurring support worker (graceful frozen-user skip), campaign contributions, FX marketplace quote selection, and referral rewards. 30 Jest tests in `server/tests/riskControls.test.ts`. Run: `npm run test:risk`.
-   Integrated backend safety layer with services for:
    -   **Kill Switches:** Temporarily disable platform features (6 kill switches: remittance, topup, recurring_support, campaign_payout, fx_marketplace, referral_rewards).
    -   **Transaction & Velocity Limits:** Configurable limits for transfers and other financial activities.
    -   **Safety Guards:** Pre-flight checks for user status, KYC, liquidity, and repeated failures.
-   **Typed Errors:** Provides structured error responses for specific risk control failures.
-   **Admin Endpoints:** Allows administrators to manage system controls, risk limits, and user risk flags (freeze/unfreeze/review).

## External Dependencies
-   **Firebase:** Authentication, Firestore (database), Firebase Storage (KYC documents).
-   **Expo SDK:** Core framework.
-   **React Native:** UI framework.
-   **React Navigation:** In-app navigation.
-   **TanStack React Query:** Data fetching.
-   **Chapa API:** Payout connector.
-   **Telebirr API:** Payout connector.
-   **Ethiopian Bank APIs:** Integration with banks like Dashen, Awash, CBE, Abyssinia for payouts and FX quotes.