# NeoBanker Mobile App

A React Native mobile app for NeoBanker - Ethiopian Digital Banking platform, built with Expo.

## Features

- **Dashboard**: View balance, quick actions, recent transactions
- **Transactions**: Full transaction history with filtering
- **Remittance**: Send money internationally with real-time exchange rates
- **Savings Goals**: Create and track savings goals
- **Profile**: Account settings and preferences
- **Authentication**: Firebase authentication with secure login

## Prerequisites

- Node.js 18+ installed
- Expo Go app on your mobile device ([iOS](https://apps.apple.com/app/expo-go/id982107779) | [Android](https://play.google.com/store/apps/details?id=host.exp.exponent))

## Quick Start

### 1. Download the Mobile Folder

Download the entire `mobile` folder from your Replit project.

### 2. Install Dependencies

```bash
cd mobile
npm install
```

### 3. Configure Environment

Create a `.env` file in the mobile folder:

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```
EXPO_PUBLIC_API_URL=https://your-neobanker-app.replit.app
EXPO_PUBLIC_FIREBASE_API_KEY=your-firebase-api-key
EXPO_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
EXPO_PUBLIC_FIREBASE_APP_ID=your-app-id
```

### 4. Start the Development Server

```bash
npx expo start
```

### 5. Run on Your Device

1. Open the Expo Go app on your phone
2. Scan the QR code displayed in the terminal
3. The app will load on your device!

## Project Structure

```
mobile/
├── App.tsx                 # App entry point
├── app.json               # Expo configuration
├── package.json           # Dependencies
├── src/
│   ├── components/        # Reusable UI components
│   ├── hooks/             # Custom React hooks
│   │   └── useAuth.tsx    # Authentication hook
│   ├── navigation/        # React Navigation setup
│   │   └── RootNavigator.tsx
│   ├── screens/           # App screens
│   │   ├── AuthScreen.tsx
│   │   ├── DashboardScreen.tsx
│   │   ├── TransactionsScreen.tsx
│   │   ├── RemittanceScreen.tsx
│   │   ├── SavingsScreen.tsx
│   │   └── ProfileScreen.tsx
│   ├── services/          # API and external services
│   │   ├── api.ts         # Backend API client
│   │   └── firebase.ts    # Firebase configuration
│   └── types/             # TypeScript types
│       └── index.ts
└── assets/                # Images and icons
```

## Connecting to Your Backend

The mobile app connects to your existing NeoBanker web backend. Make sure:

1. Your Replit NeoBanker app is running and deployed
2. Update `EXPO_PUBLIC_API_URL` in `.env` with your app's URL
3. The backend CORS settings allow requests from the Expo development server

## Building for Production

### Build for Android

```bash
npx expo build:android
```

### Build for iOS

```bash
npx expo build:ios
```

Or use EAS Build for more control:

```bash
npx eas build --platform android
npx eas build --platform ios
```

## Customization

### Colors (Ethiopian Theme)
The app uses Ethiopian flag colors:
- Green: `#006633` (Primary)
- Gold: `#FFD700` (Accent)
- Red: `#DC2626` (Alerts)

### Adding New Screens
1. Create screen in `src/screens/`
2. Add to navigation in `src/navigation/RootNavigator.tsx`
3. Add tab icon if needed

## Troubleshooting

### "Network Request Failed"
- Ensure your backend URL is correct
- Check that your Replit app is running
- Make sure CORS is properly configured

### Firebase Authentication Issues
- Verify Firebase config values in `.env`
- Check that your Firebase project has email/password auth enabled

### Expo Go Not Loading
- Make sure phone and computer are on same WiFi network
- Try using tunnel mode: `npx expo start --tunnel`

## Support

For issues with the mobile app, check:
- [Expo Documentation](https://docs.expo.dev)
- [React Navigation Docs](https://reactnavigation.org/docs/getting-started)
- [React Native Documentation](https://reactnative.dev)

---

Built with ❤️ for the Ethiopian Diaspora
