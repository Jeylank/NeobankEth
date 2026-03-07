import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';
import { ActivityIndicator, View } from 'react-native';

import AuthScreen from '../screens/AuthScreen';
import DashboardScreen from '../screens/DashboardScreen';
import TransactionsScreen from '../screens/TransactionsScreen';
import RemittanceScreen from '../screens/RemittanceScreen';
import SavingsScreen from '../screens/SavingsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import BillPaymentsScreen from '../screens/BillPaymentsScreen';
import BankAccountsScreen from '../screens/BankAccountsScreen';
import ChapaPaymentScreen from '../screens/ChapaPaymentScreen';
import TelebirrPaymentScreen from '../screens/TelebirrPaymentScreen';
import KYCScreen from '../screens/KYCScreen';
import SupportScreen from '../screens/SupportScreen';
import RemittanceTrackingScreen from '../screens/RemittanceTrackingScreen';
import ReferFriendScreen from '../screens/ReferFriendScreen';
import LanguageScreen from '../screens/LanguageScreen';
import InsightsScreen from '../screens/InsightsScreen';
import FamilyWalletScreen from '../screens/FamilyWalletScreen';
import FamilyRequestsScreen from '../screens/FamilyRequestsScreen';
import RequestMoneyScreen from '../screens/RequestMoneyScreen';
import RecurringSupportScreen from '../screens/RecurringSupportScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const COLORS = {
  primary: '#006633',
  gold: '#FFD700',
  white: '#FFFFFF',
  gray: '#6B7280',
};

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: keyof typeof Ionicons.glyphMap = 'home';

          switch (route.name) {
            case 'Dashboard':
              iconName = focused ? 'home' : 'home-outline';
              break;
            case 'Transactions':
              iconName = focused ? 'list' : 'list-outline';
              break;
            case 'Remittance':
              iconName = focused ? 'send' : 'send-outline';
              break;
            case 'Savings':
              iconName = focused ? 'wallet' : 'wallet-outline';
              break;
            case 'Profile':
              iconName = focused ? 'person' : 'person-outline';
              break;
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.gray,
        headerStyle: {
          backgroundColor: COLORS.primary,
        },
        headerTintColor: COLORS.white,
        headerTitleStyle: {
          fontWeight: 'bold',
        },
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'Home' }} />
      <Tab.Screen name="Transactions" component={TransactionsScreen} />
      <Tab.Screen name="Remittance" component={RemittanceScreen} options={{ title: 'Send Money' }} />
      <Tab.Screen name="Savings" component={SavingsScreen} options={{ title: 'Savings Goals' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.primary }}>
        <ActivityIndicator size="large" color={COLORS.white} />
      </View>
    );
  }

  return (
    <Stack.Navigator 
      screenOptions={{ 
        headerStyle: {
          backgroundColor: COLORS.primary,
        },
        headerTintColor: COLORS.white,
        headerTitleStyle: {
          fontWeight: 'bold',
        },
      }}
    >
      {isAuthenticated ? (
        <>
          <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
          <Stack.Screen name="BillPayments" component={BillPaymentsScreen} options={{ title: 'Pay Bills' }} />
          <Stack.Screen name="BankAccounts" component={BankAccountsScreen} options={{ title: 'Linked Accounts' }} />
          <Stack.Screen name="ChapaPayment" component={ChapaPaymentScreen} options={{ title: 'Chapa Payment' }} />
          <Stack.Screen name="TelebirrPayment" component={TelebirrPaymentScreen} options={{ title: 'Telebirr Payment' }} />
          <Stack.Screen name="KYC" component={KYCScreen} options={{ title: 'Identity Verification' }} />
          <Stack.Screen name="Support" component={SupportScreen} options={{ title: 'Help & Support' }} />
          <Stack.Screen name="RemittanceTracking" component={RemittanceTrackingScreen} options={{ title: 'Track Transfers' }} />
          <Stack.Screen name="ReferFriend" component={ReferFriendScreen} options={{ title: 'Refer a Friend' }} />
          <Stack.Screen name="Language" component={LanguageScreen} options={{ title: 'Language' }} />
          <Stack.Screen name="Insights" component={InsightsScreen} options={{ title: 'Insights' }} />
          <Stack.Screen name="FamilyWallet" component={FamilyWalletScreen} options={{ title: 'Family Wallet' }} />
          <Stack.Screen name="FamilyRequests" component={FamilyRequestsScreen} options={{ title: 'Family Requests' }} />
          <Stack.Screen name="RequestMoney" component={RequestMoneyScreen} options={{ title: 'Request Support' }} />
          <Stack.Screen name="RecurringSupport" component={RecurringSupportScreen} options={{ title: 'Recurring Support' }} />
        </>
      ) : (
        <Stack.Screen name="Auth" component={AuthScreen} options={{ headerShown: false }} />
      )}
    </Stack.Navigator>
  );
}
