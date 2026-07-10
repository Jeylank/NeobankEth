import fs from 'fs';
import path from 'path';

const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf8');

describe('admin console and screen contracts', () => {
  it('registers every scoped screen in the navigator and protects it with AdminGuard', () => {
    const navigator = read('src/navigation/RootNavigator.tsx');
    for (const screen of ['AdminConsole', 'AdminOverview', 'AdminTransfers', 'AdminUsers', 'AdminAuditLogs', 'AdminBetaRiskSummary']) {
      expect(navigator).toContain(`name="${screen}"`);
      const screenSource = read(`src/screens/admin/${screen}Screen.tsx`);
      expect(screenSource).toContain('<AdminGuard>');
    }
  });

  it('maps scoped Admin Console cards to the correct screens', () => {
    const consoleSource = read('src/screens/admin/AdminConsoleScreen.tsx');
    for (const screen of ['AdminOverview', 'AdminTransfers', 'AdminUsers', 'AdminAuditLogs', 'AdminBetaRiskSummary']) {
      expect(consoleSource).toContain(`screen: '${screen}'`);
    }
    expect(consoleSource).toContain('navigation.navigate(item.screen)');
  });

  it('registers web deep links for every scoped screen', () => {
    const configuredApp = read('src/components/ConfiguredApp.tsx');
    const expected = {
      AdminConsole: 'admin/console', AdminOverview: 'admin/overview', AdminTransfers: 'admin/transfers',
      AdminUsers: 'admin/users', AdminAuditLogs: 'admin/audit-logs', AdminBetaRiskSummary: 'admin/beta-risk-summary',
    };
    for (const [screen, route] of Object.entries(expected)) {
      expect(configuredApp).toContain(`${screen}: '${route}'`);
    }
  });

  it('implements beta-risk loading, error, empty-alert, manual refresh, and 30-second refresh states', () => {
    const source = read('src/screens/admin/AdminBetaRiskSummaryScreen.tsx');
    expect(source).toContain('isLoading');
    expect(source).toContain('error ?');
    expect(source).toContain('(data?.alerts.recent ?? []).length === 0');
    expect(source).toContain('onRefresh={refetch}');
    expect(source).toContain('refetchInterval: 30_000');
  });

  it('requires confirmation before transfer retry and does not expose the public API-key debug route', () => {
    const transfers = read('src/screens/admin/AdminTransfersScreen.tsx');
    const server = read('server/index.ts');
    expect(transfers).toContain('Alert.alert(');
    expect(transfers).toContain('onPress: () => retryMutation.mutate');
    expect(transfers).toContain("confirmAction(detailQuery.data.txId, 'recovery')");
    expect(transfers).toContain("confirmAction(detailQuery.data.txId, 'refund')");
    for (const section of ['Ledger entries', 'Payment confirmation', 'Agent', 'OTP state', 'Reconciliation reports &amp; alerts']) {
      expect(transfers).toContain(section);
    }
    expect(server).not.toContain("app.get('/debug/api-key-check'");
    expect(server).not.toContain('expectedFirst6');
  });

  it('whitelists transfer operational detail and never returns OTP/token fields or raw documents', () => {
    const service = read('server/services/adminTransfersService.ts');
    expect(service).not.toContain('raw:      data');
    expect(service).toContain('otpState:');
    expect(service).toContain("status: 'NOT_SENT'");
    expect(service).not.toMatch(/return \{[^}]*otp_hash|return \{[^}]*payout_token/s);
    expect(service).toContain('ledgerEntries:');
    expect(service).toContain('paymentConfirmation:');
    expect(service).toContain('agentAssignment:');
    expect(service).toContain('reconciliation:');
    expect(service).toContain('alerts:');
  });

  it('keeps audit logs UI read-only and lists all required event categories', () => {
    const screen = read('src/screens/admin/AdminAuditLogsScreen.tsx');
    for (const event of ['LOGIN', 'SEND_MONEY', 'AGENT_ASSIGNED', 'OTP_GENERATED', 'PAYOUT_COMPLETED', 'KYC_CHANGE', 'ADMIN_ACTION']) {
      expect(screen).toContain(`'${event}'`);
    }
    expect(screen).not.toMatch(/useMutation|\.post\(|\.patch\(|\.delete\(/);
  });
});
