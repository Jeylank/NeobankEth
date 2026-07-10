import { buildMainTabReset } from '../../src/navigation/transferSuccessNavigation';

describe('TransferSuccess navigation actions', () => {
  it('resets Done to the Dashboard tab inside Main', () => {
    expect(buildMainTabReset('Dashboard')).toEqual({
      index: 0,
      routes: [
        {
          name: 'Main',
          params: { screen: 'Dashboard' },
        },
      ],
    });
  });
});
