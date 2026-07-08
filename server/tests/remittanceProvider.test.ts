import type { IRemittanceProvider } from '../services/remittance/IRemittanceProvider';
import { createRemittanceProvider, getAppMode } from '../services/remittance';

function providerSpy(): IRemittanceProvider & { initiate: jest.Mock } {
  return {
    initiate: jest.fn().mockResolvedValue({ ok: true, status: 201, payload: {} }),
  };
}

describe('remittance provider selection', () => {
  it('defaults APP_MODE to simulation', () => {
    expect(getAppMode({})).toBe('simulation');
  });

  it('never calls ProductionProvider in simulation mode', async () => {
    const simulation = providerSpy();
    const production = providerSpy();
    const provider = createRemittanceProvider(
      { APP_MODE: 'simulation' },
      { simulation, production },
    );

    await provider.initiate({
      userId: 'user-1',
      recipientId: 'recipient-1',
      amount: 10,
      currency: 'EUR',
      type: 'standard',
    });

    expect(simulation.initiate).toHaveBeenCalledTimes(1);
    expect(production.initiate).not.toHaveBeenCalled();
  });

  it('does not select production for unset or unrecognised APP_MODE', () => {
    const simulation = providerSpy();
    const production = providerSpy();

    expect(createRemittanceProvider({}, { simulation, production })).toBe(simulation);
    expect(createRemittanceProvider(
      { APP_MODE: 'Production' },
      { simulation, production },
    )).toBe(simulation);
    expect(production.initiate).not.toHaveBeenCalled();
  });

  it('selects production only for exact APP_MODE=production', () => {
    const simulation = providerSpy();
    const production = providerSpy();

    expect(createRemittanceProvider(
      { APP_MODE: 'production' },
      { simulation, production },
    )).toBe(production);
  });
});
