# NeoBanker Mobile App

## Overview
NeoBanker is an Expo React Native mobile banking application with web support. It provides features like authentication, remittance tracking, bill payments, bank account management, and more.

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
The app runs on port 5000 using Expo for web:
```
npm run web
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
