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
