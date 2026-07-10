export type MainTabName = 'Dashboard' | 'Transactions' | 'Remittance';

export function buildMainTabReset(screen: MainTabName) {
  return {
    index: 0,
    routes: [
      {
        name: 'Main',
        params: { screen },
      },
    ],
  };
}
