# Habeshare Mobile App

## Overview
Habeshare is an Expo React Native mobile banking application with web support, following a NON-CUSTODIAL PARTNER MODEL. Habeshare does NOT hold user funds - all funds are held and processed by licensed financial institutions in Ethiopia. It provides features like authentication, remittance tracking, bill payments, and KYC verification with multi-language support for Ethiopian languages.

## Project Structure
- `App.tsx` - Main application entry point
- `src/` - Source code directory
  - `components/` - Reusable UI components
  - `hooks/` - Custom React hooks (useAuth, etc.)
  - `navigation/` - React Navigation setup
  - `screens/` - Application screens
  - `services/` - API and service integrations
  - `theme/` - Theme configuration and styling
  - `types/` - TypeScript type definitions
  - `utils/` - Utility functions
- `assets/fonts/` - Custom Ethiopic fonts

## Running the App
The app runs on port 5000 using a static build for stability:
```
npm run web          # Builds and serves static files
npm run web:dev      # Development mode with hot reload (less stable)
npm run build:web    # Build only (outputs to dist/)
```

## Environment Variables Required
Copy `.env.example` to `.env` and configure:
- `EXPO_PUBLIC_API_URL` - Backend API URL
- `EXPO_PUBLIC_FIREBASE_API_KEY` - Firebase API key
- `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` - Firebase auth domain
- `EXPO_PUBLIC_FIREBASE_PROJECT_ID` - Firebase project ID
- `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` - Firebase storage bucket
- `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` - Firebase messaging sender ID
- `EXPO_PUBLIC_FIREBASE_APP_ID` - Firebase app ID

## Tech Stack
- Expo SDK 50
- React Native 0.73
- React Navigation 6
- TanStack React Query
- Firebase (for authentication and notifications)
- TypeScript

## Recent Changes
- January 2026: Initial setup in Replit environment
- Configured Expo web to run on port 5000
- Removed NativeWind babel plugin for Metro compatibility
- Added NotoSansEthiopic variable font files
- Switched to static build for stable preview (no hot reload flickering)
- Added Forgot Password functionality on login screen
- Added Tigrinya (ትግርኛ) language support
- Added "What We Offer" features showcase on dashboard
- Implemented KYC ID document scanning/upload with Firebase Storage integration
- Added phone number authentication with +251 Ethiopian number pre-validation
- Rebranded from NeoBanker to Habeshare with non-custodial partner model
- Replaced wallet balances with transaction status summary (Money Sent, Delivered, Pending)
- Added regulatory disclaimers throughout the app
- Removed all "Bank/Banking" terminology for regulatory compliance (replaced with Finance, Linked Accounts, Direct Transfer, etc.)
- Removed all NeoBanker references, replaced with Habeshare branding
- Updated tagline to "Habeshare Global" and footer to "Secure Services for the Ethiopian Diaspora"
- Added Family Wallet feature: manage monthly support for family members in Ethiopia with allocation tracking, donut chart, Send Now, and full i18n support
- Connected Family Wallet to Firebase Firestore: data persisted under users/{uid}/family_members, audit logs under users/{uid}/family_audit_log, monthly sent records under users/{uid}/family_sent. Replaced AsyncStorage mock. Added error state with retry. Connected Send Now to remittanceApi.initiateTransfer. Dev mode seeds sample data on empty Firestore.
- Added Family Request feature: family members in Ethiopia can request financial support from diaspora users. Includes RequestMoneyScreen (create request form with purpose picker), FamilyRequestsScreen (incoming/sent tabs with approve/decline), Firestore service with local fallback, notification integration, and full i18n (4 languages).
- Refined Family Request for production-readiness: expanded status lifecycle (pending→processing→completed/failed, declined), transactionId/approvedAt/approvedBy tracking, audit logs (request_created, request_approved, request_declined, payout_initiated_from_request), duplicate approval protection, renamed "Incoming" tab to "Support Requests", restricted AsyncStorage fallback to dev-only (production shows offline/read-only state), offline banner UI.
- Added Recurring Support Automation: users can schedule automated payments to family members (weekly/biweekly/monthly/quarterly/semester). Includes schedule CRUD, processDueSchedules engine (queues payouts via remittanceApi), execution history tracking, pause/resume/cancel, Process Now manual trigger. Firestore: users/{uid}/recurring_schedules, users/{uid}/schedule_executions. Full i18n (51 keys × 4 languages).
- Added Family Circle (Group Support): multiple diaspora members can pool together to support the same family member(s). Circle CRUD, member management (add/remove/invite), contribution tracking, progress visualization, payout processing when target reached. Firestore: users/{uid}/family_circles, users/{uid}/circle_contributions, users/{uid}/circle_audit_log. Full i18n (59 keys × 4 languages).
- Added Support Campaigns: fundraising for medical, funeral, education, emergency. Campaign CRUD, category filtering, contribution flow with remittanceApi, progress tracking, auto-complete on goal reached, contributor lists, creator campaign management. Firestore: support_campaigns, campaign_contributions (top-level). Full i18n (50 keys × 4 languages).
- Added Multi-Currency Wallet with ledger-based architecture: EUR/USD/GBP balances, immutable ledger entries (CREDIT/DEBIT), wallet operations (createWallet, creditWallet, debitWallet, reserveFunds, releaseReservation, confirmReservation), currency conversion with FX rates (1.5% fee), wallet activity feed. Top-up flow via Card/Chapa/Telebirr. WalletScreen with balance cards, quick actions, Add Money/Convert/Activity modals. Firestore: wallets/{userId}, wallets/{userId}/entries/{entryId}, fx_conversions (top-level). Full i18n (62 keys × 4 languages).
- Added Transparent FX screen: live rate comparison table (EUR/USD/GBP→ETB), rate calculator with fee breakdown, transparency info cards, quick convert link to wallet. Full i18n (35 keys × 4 languages).
- Added Notifications system: NotificationsScreen with type-based icons, read/unread styling, mark-all-as-read, filter tabs (All/Transactions/Remittance/Security). Dashboard bell icon with unread count badge. Connected to firestoreNotifications service. Full i18n (29 keys × 4 languages).
- Polished Referral system: updated code prefix from NB→HS, added i18n for all text (34 keys × 4 languages), added referral terms section.
- Added Security hardening: SessionManager (auto-logout after timeout), biometric confirmation for sensitive actions, input sanitization, amount validation, account masking utilities in src/utils/security.ts. SecuritySettingsScreen with session timeout picker, biometric toggles, change password, 2FA placeholder, login activity, security tips. Full i18n (27 keys × 4 languages).
- Added production-ready payout connectors: src/services/payoutConnectors.ts with Chapa, Telebirr, and Bank payout APIs. Methods: sendPayout(), checkPayoutStatus(), validateAccount(). Stores provider reference IDs. Updates transaction documents with {provider, providerRef, payoutStatus}. Exponential retry handling (3 retries with 2s/5s/15s delays). Firestore: payout_transactions (top-level). Updated Transaction type with provider/providerRef/payoutStatus fields. PaymentGatewayService.initiatePayout() and checkTransactionStatus() now delegate to real connectors.
- Added admin-only Operations Console: 7 admin screens in src/screens/admin/ (AdminConsoleScreen, AdminOverviewScreen, AdminPayoutMonitoringScreen, AdminFraudAlertsScreen, AdminSupportTicketsScreen, AdminDisputesScreen, AdminLiquidityScreen). Admin service layer (src/services/adminService.ts) with all admin API methods. AdminGuard component (src/components/AdminGuard.tsx) enforces role-based access. useAuth hook updated with isAdmin flag fetched from user profile. ProfileScreen shows "Operations Console" entry only for admin users. Full i18n (112 keys × 4 languages). Admin types added to src/types/index.ts. All admin routes wired in RootNavigator.
