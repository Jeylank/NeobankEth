import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';
import { useUnreadNotifications } from '../hooks/useUnreadNotifications';
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
import FundingMethodScreen from '../screens/FundingMethodScreen';
import BankTransferFundingScreen from '../screens/BankTransferFundingScreen';
import CardTopUpScreen from '../screens/CardTopUpScreen';
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
import FamilyCircleScreen from '../screens/FamilyCircleScreen';
import SupportCampaignsScreen from '../screens/SupportCampaignsScreen';
import WalletScreen from '../screens/WalletScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import TransparentFXScreen from '../screens/TransparentFXScreen';
import SecuritySettingsScreen from '../screens/SecuritySettingsScreen';
import FxMarketplaceScreen from '../screens/FxMarketplaceScreen';
import TransferTrackingScreen from '../screens/TransferTrackingScreen';
import TransferSuccessScreen from '../screens/TransferSuccessScreen';
import PendingLiquidityScreen from '../screens/PendingLiquidityScreen';
import RecipientsScreen from '../screens/RecipientsScreen';
import PersonalInformationScreen from '../screens/PersonalInformationScreen';
import AboutScreen from '../screens/AboutScreen';
import TwoFactorVerifyScreen from '../screens/TwoFactorVerifyScreen';
import TwoFactorSetupScreen from '../screens/TwoFactorSetupScreen';
import AdminConsoleScreen from '../screens/admin/AdminConsoleScreen';
import AdminOverviewScreen from '../screens/admin/AdminOverviewScreen';
import AdminPayoutMonitoringScreen from '../screens/admin/AdminPayoutMonitoringScreen';
import AdminAgentPayoutsScreen from '../screens/admin/AdminAgentPayoutsScreen';
import AdminFraudAlertsScreen from '../screens/admin/AdminFraudAlertsScreen';
import AdminSupportTicketsScreen from '../screens/admin/AdminSupportTicketsScreen';
import AdminDisputesScreen from '../screens/admin/AdminDisputesScreen';
import AdminLiquidityScreen from '../screens/admin/AdminLiquidityScreen';
import AdminReconciliationOverviewScreen from '../screens/admin/AdminReconciliationOverviewScreen';
import AdminReconciliationRunsScreen from '../screens/admin/AdminReconciliationRunsScreen';
import AdminReconciliationAlertsScreen from '../screens/admin/AdminReconciliationAlertsScreen';
import AdminReconciliationRunDetailScreen from '../screens/admin/AdminReconciliationRunDetailScreen';
import AdminTreasuryOverviewScreen from '../screens/admin/AdminTreasuryOverviewScreen';
import AdminLiquidityPoolsScreen from '../screens/admin/AdminLiquidityPoolsScreen';
import AdminTreasuryReservationsScreen from '../screens/admin/AdminTreasuryReservationsScreen';
import AdminSettlementObligationsScreen from '../screens/admin/AdminSettlementObligationsScreen';
import AdminTreasuryAlertsScreen from '../screens/admin/AdminTreasuryAlertsScreen';
import AdminSettlementsScreen from '../screens/admin/AdminSettlementsScreen';
import AdminReconciliationScreen from '../screens/admin/AdminReconciliationScreen';
import AdminSettlementOverviewScreen from '../screens/admin/AdminSettlementOverviewScreen';
import AdminSettlementEngineObligationsScreen from '../screens/admin/AdminSettlementEngineObligationsScreen';
import AdminSettlementBatchesScreen from '../screens/admin/AdminSettlementBatchesScreen';
import AdminSettlementAlertsScreen from '../screens/admin/AdminSettlementAlertsScreen';
import AdminSettlementReconciliationScreen from '../screens/admin/AdminSettlementReconciliationScreen';
import AdminSchedulerHistoryScreen from '../screens/admin/AdminSchedulerHistoryScreen';
import AdminSystemMonitorScreen from '../screens/admin/AdminSystemMonitorScreen';
import AdminSchedulerRunsScreen from '../screens/admin/AdminSchedulerRunsScreen';
import AdminRiskControlsScreen from '../screens/admin/AdminRiskControlsScreen';
import AdminDashboardScreen from '../screens/admin/AdminDashboardScreen';
import SubscriptionScreen from '../screens/SubscriptionScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const COLORS = {
  primary: '#006633',
  gold: '#FFD700',
  white: '#FFFFFF',
  gray: '#6B7280',
};

function MainTabs() {
  const unreadCount = useUnreadNotifications();

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
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          title: 'Home',
          tabBarBadge: unreadCount > 0 ? (unreadCount > 99 ? '99+' : unreadCount) : undefined,
        }}
      />
      <Tab.Screen name="Transactions" component={TransactionsScreen} />
      <Tab.Screen name="Remittance" component={RemittanceScreen} options={{ title: 'Send Money' }} />
      <Tab.Screen name="Savings" component={SavingsScreen} options={{ title: 'Savings Goals' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { isAuthenticated, isLoading, pending2FA } = useAuth();

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
      {pending2FA ? (
        <Stack.Screen name="TwoFactorVerify" component={TwoFactorVerifyScreen} options={{ headerShown: false }} />
      ) : isAuthenticated ? (
        <>
          <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
          <Stack.Screen name="BillPayments" component={BillPaymentsScreen} options={{ title: 'Pay Bills' }} />
          <Stack.Screen name="BankAccounts" component={BankAccountsScreen} options={{ title: 'Linked Accounts' }} />
          <Stack.Screen name="FundingMethod" component={FundingMethodScreen} options={{ title: 'Add Funds' }} />
          <Stack.Screen name="BankTransferFunding" component={BankTransferFundingScreen} options={{ title: 'Bank Transfer' }} />
          <Stack.Screen name="CardTopUp" component={CardTopUpScreen} options={{ title: 'Card Payment' }} />
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
          <Stack.Screen name="FamilyCircle" component={FamilyCircleScreen} options={{ title: 'Family Circle' }} />
          <Stack.Screen name="SupportCampaigns" component={SupportCampaignsScreen} options={{ title: 'Support Campaigns' }} />
          <Stack.Screen name="Wallet" component={WalletScreen} options={{ title: 'Wallet' }} />
          <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Notifications' }} />
          <Stack.Screen name="TransparentFX" component={TransparentFXScreen} options={{ title: 'Transparent FX' }} />
          <Stack.Screen name="SecuritySettings" component={SecuritySettingsScreen} options={{ title: 'Security' }} />
          <Stack.Screen name="FxMarketplace" component={FxMarketplaceScreen} options={{ title: 'FX Marketplace' }} />
          <Stack.Screen name="TransferTracking" component={TransferTrackingScreen} options={{ headerShown: false }} />
          <Stack.Screen name="TransferSuccess" component={TransferSuccessScreen} options={{ headerShown: false, gestureEnabled: false }} />
          <Stack.Screen name="PendingLiquidity" component={PendingLiquidityScreen} options={{ title: 'Pending Liquidity' }} />
          <Stack.Screen name="Recipients" component={RecipientsScreen} options={{ title: 'Recipients' }} />
          <Stack.Screen name="PersonalInformation" component={PersonalInformationScreen} options={{ title: 'Personal Information' }} />
          <Stack.Screen name="About" component={AboutScreen} options={{ title: 'About Sumsuma' }} />
          <Stack.Screen name="TwoFactorSetup" component={TwoFactorSetupScreen} options={{ title: 'Two-Factor Authentication' }} />
          <Stack.Screen name="AdminConsole" component={AdminConsoleScreen} options={{ headerShown: false }} />
          <Stack.Screen name="AdminOverview" component={AdminOverviewScreen} options={{ title: 'Overview' }} />
          <Stack.Screen name="AdminPayoutMonitoring" component={AdminPayoutMonitoringScreen} options={{ title: 'Payout Monitoring' }} />
          <Stack.Screen name="AdminAgentPayouts" component={AdminAgentPayoutsScreen} options={{ title: 'Agent Cash Payouts' }} />
          <Stack.Screen name="AdminFraudAlerts" component={AdminFraudAlertsScreen} options={{ title: 'Fraud Alerts' }} />
          <Stack.Screen name="AdminSupportTickets" component={AdminSupportTicketsScreen} options={{ title: 'Support Tickets' }} />
          <Stack.Screen name="AdminDisputes" component={AdminDisputesScreen} options={{ title: 'Disputes' }} />
          <Stack.Screen name="AdminLiquidity" component={AdminLiquidityScreen} options={{ title: 'Liquidity' }} />
          <Stack.Screen name="AdminReconciliationOverview" component={AdminReconciliationOverviewScreen} options={{ title: 'Reconciliation' }} />
          <Stack.Screen name="AdminReconciliationRuns" component={AdminReconciliationRunsScreen} options={{ title: 'Reconciliation Runs' }} />
          <Stack.Screen name="AdminReconciliationAlerts" component={AdminReconciliationAlertsScreen} options={{ title: 'Reconciliation Alerts' }} />
          <Stack.Screen name="AdminReconciliationRunDetail" component={AdminReconciliationRunDetailScreen} options={{ title: 'Run Detail' }} />
          <Stack.Screen name="AdminTreasuryOverview" component={AdminTreasuryOverviewScreen} options={{ title: 'Treasury' }} />
          <Stack.Screen name="AdminLiquidityPools" component={AdminLiquidityPoolsScreen} options={{ title: 'Liquidity Pools' }} />
          <Stack.Screen name="AdminTreasuryReservations" component={AdminTreasuryReservationsScreen} options={{ title: 'Reservations' }} />
          <Stack.Screen name="AdminSettlementObligations" component={AdminSettlementObligationsScreen} options={{ title: 'Settlement Obligations' }} />
          <Stack.Screen name="AdminTreasuryAlerts" component={AdminTreasuryAlertsScreen} options={{ title: 'Treasury Alerts' }} />
          <Stack.Screen name="AdminSettlements" component={AdminSettlementsScreen} options={{ title: 'Partner Settlements' }} />
          <Stack.Screen name="AdminReconciliation" component={AdminReconciliationScreen} options={{ title: 'Reconciliation Reports' }} />
          <Stack.Screen name="AdminSettlementEngine" component={AdminSettlementOverviewScreen} options={{ title: 'Settlement Engine' }} />
          <Stack.Screen name="AdminSettlementEngineObligations" component={AdminSettlementEngineObligationsScreen} options={{ title: 'Settlement Obligations' }} />
          <Stack.Screen name="AdminSettlementBatches" component={AdminSettlementBatchesScreen} options={{ title: 'Settlement Batches' }} />
          <Stack.Screen name="AdminSettlementAlerts" component={AdminSettlementAlertsScreen} options={{ title: 'Settlement Alerts' }} />
          <Stack.Screen name="AdminSettlementReconciliation" component={AdminSettlementReconciliationScreen} options={{ title: 'Settlement Reconciliation' }} />
          <Stack.Screen name="AdminSchedulerHistory" component={AdminSchedulerHistoryScreen} options={{ title: 'Scheduler Run History' }} />
          <Stack.Screen name="AdminSystemMonitor" component={AdminSystemMonitorScreen} options={{ title: 'System Monitor' }} />
          <Stack.Screen name="AdminSchedulerRuns" component={AdminSchedulerRunsScreen} options={{ title: 'Recurring Support Runs' }} />
          <Stack.Screen name="AdminRiskControls" component={AdminRiskControlsScreen} options={{ headerShown: false }} />
          <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Subscription" component={SubscriptionScreen} options={{ title: 'Manage Plan' }} />
        </>
      ) : (
        <Stack.Screen name="Auth" component={AuthScreen} options={{ headerShown: false }} />
      )}
    </Stack.Navigator>
  );
}
