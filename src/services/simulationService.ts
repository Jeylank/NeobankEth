import { PayoutProvider, PayoutStatus } from '../types';

export interface SimulationStep {
  id: string;
  status: 'idle' | 'running' | 'completed' | 'failed';
  data?: Record<string, any>;
  timestamp?: string;
}

export interface SimulationState {
  currentStep: number;
  steps: SimulationStep[];
  isRunning: boolean;
  isComplete: boolean;
}

const STEP_IDS = [
  'signup',
  'kyc',
  'wallet_topup',
  'fx_calculation',
  'remittance',
  'partner_payout',
  'completion',
] as const;

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

const MOCK_FX_RATES: Record<string, number> = {
  USD: 56.50,
  EUR: 61.20,
  GBP: 71.80,
};

const FEE_PERCENT = 0.015;

export function createInitialState(): SimulationState {
  return {
    currentStep: 0,
    steps: STEP_IDS.map((id) => ({ id, status: 'idle' })),
    isRunning: false,
    isComplete: false,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runSignup(
  onUpdate: (state: SimulationState) => void,
  state: SimulationState,
): Promise<SimulationState> {
  state = { ...state, isRunning: true, currentStep: 0 };
  state.steps = state.steps.map((s, i) =>
    i === 0 ? { ...s, status: 'running' } : s,
  );
  onUpdate(state);
  await delay(1800);

  const userId = generateId('USR');
  const signupData = {
    userId,
    email: 'demo.user@habeshare.com',
    phone: '+251912345678',
    method: 'email',
    createdAt: now(),
  };

  state.steps = state.steps.map((s, i) =>
    i === 0 ? { ...s, status: 'completed', data: signupData, timestamp: now() } : s,
  );
  onUpdate(state);
  return state;
}

export async function runKYC(
  onUpdate: (state: SimulationState) => void,
  state: SimulationState,
): Promise<SimulationState> {
  state = { ...state, currentStep: 1 };
  state.steps = state.steps.map((s, i) =>
    i === 1 ? { ...s, status: 'running' } : s,
  );
  onUpdate(state);
  await delay(1200);

  const kycData = {
    documentType: 'passport',
    documentNumber: 'EP7891234',
    fullName: 'Abebe Tadesse',
    dateOfBirth: '15/03/1990',
    status: 'pending',
    submittedAt: now(),
  };
  state.steps = state.steps.map((s, i) =>
    i === 1 ? { ...s, data: kycData } : s,
  );
  onUpdate(state);
  await delay(1500);

  kycData.status = 'verified';
  state.steps = state.steps.map((s, i) =>
    i === 1
      ? { ...s, status: 'completed', data: { ...kycData }, timestamp: now() }
      : s,
  );
  onUpdate(state);
  return state;
}

export async function runWalletTopup(
  onUpdate: (state: SimulationState) => void,
  state: SimulationState,
): Promise<SimulationState> {
  state = { ...state, currentStep: 2 };
  state.steps = state.steps.map((s, i) =>
    i === 2 ? { ...s, status: 'running' } : s,
  );
  onUpdate(state);
  await delay(1400);

  const walletData = {
    walletId: generateId('WLT'),
    currency: 'EUR',
    previousBalance: 0,
    topupAmount: 500,
    newBalance: 500,
    paymentMethod: 'card',
    ledgerEntry: {
      type: 'CREDIT',
      category: 'TOPUP',
      amount: 500,
      currency: 'EUR',
    },
    completedAt: now(),
  };

  state.steps = state.steps.map((s, i) =>
    i === 2
      ? { ...s, status: 'completed', data: walletData, timestamp: now() }
      : s,
  );
  onUpdate(state);
  return state;
}

export async function runFXCalculation(
  onUpdate: (state: SimulationState) => void,
  state: SimulationState,
): Promise<SimulationState> {
  state = { ...state, currentStep: 3 };
  state.steps = state.steps.map((s, i) =>
    i === 3 ? { ...s, status: 'running' } : s,
  );
  onUpdate(state);
  await delay(1000);

  const sendAmount = 200;
  const fromCurrency = 'EUR';
  const rate = MOCK_FX_RATES[fromCurrency];
  const fee = sendAmount * FEE_PERCENT;
  const netAmount = sendAmount - fee;
  const receivedETB = netAmount * rate;

  const fxData = {
    fromCurrency,
    toCurrency: 'ETB',
    sendAmount,
    fee: parseFloat(fee.toFixed(2)),
    feePercent: `${(FEE_PERCENT * 100).toFixed(1)}%`,
    netAmount: parseFloat(netAmount.toFixed(2)),
    exchangeRate: rate,
    receivedAmount: parseFloat(receivedETB.toFixed(2)),
    rateSource: 'ECB Mid-Market + 1.5%',
    calculatedAt: now(),
  };

  state.steps = state.steps.map((s, i) =>
    i === 3
      ? { ...s, status: 'completed', data: fxData, timestamp: now() }
      : s,
  );
  onUpdate(state);
  return state;
}

export async function runRemittance(
  onUpdate: (state: SimulationState) => void,
  state: SimulationState,
): Promise<SimulationState> {
  state = { ...state, currentStep: 4 };
  state.steps = state.steps.map((s, i) =>
    i === 4 ? { ...s, status: 'running' } : s,
  );
  onUpdate(state);
  await delay(1600);

  const fxData = state.steps[3].data || {};
  const txData = {
    transactionId: generateId('TXN'),
    amount: fxData.sendAmount || 200,
    fromCurrency: fxData.fromCurrency || 'EUR',
    toCurrency: 'ETB',
    receivedAmount: fxData.receivedAmount || 12058.20,
    beneficiary: {
      name: 'Meron Tadesse',
      account: '1000XXXXXXX789',
      institution: 'Commercial Bank of Ethiopia',
    },
    payoutMethod: 'bank_transfer',
    status: 'processing',
    createdAt: now(),
  };

  state.steps = state.steps.map((s, i) =>
    i === 4
      ? { ...s, status: 'completed', data: txData, timestamp: now() }
      : s,
  );
  onUpdate(state);
  return state;
}

export async function runPartnerPayout(
  onUpdate: (state: SimulationState) => void,
  state: SimulationState,
): Promise<SimulationState> {
  state = { ...state, currentStep: 5 };
  state.steps = state.steps.map((s, i) =>
    i === 5 ? { ...s, status: 'running' } : s,
  );
  onUpdate(state);
  await delay(1000);

  const provider: PayoutProvider = 'CHAPA';
  const payoutData: Record<string, any> = {
    payoutId: generateId('PAY'),
    provider,
    providerRef: '',
    payoutStatus: 'INITIATED' as PayoutStatus,
    recipientAccount: '1000XXXXXXX789',
    recipientName: 'Meron Tadesse',
    amount: state.steps[3].data?.receivedAmount || 12058.20,
    currency: 'ETB',
    retryCount: 0,
    createdAt: now(),
  };
  state.steps = state.steps.map((s, i) =>
    i === 5 ? { ...s, data: { ...payoutData } } : s,
  );
  onUpdate(state);
  await delay(1200);

  payoutData.payoutStatus = 'PROCESSING';
  payoutData.providerRef = `CHAPA_${Date.now()}`;
  state.steps = state.steps.map((s, i) =>
    i === 5 ? { ...s, data: { ...payoutData } } : s,
  );
  onUpdate(state);
  await delay(1400);

  payoutData.payoutStatus = 'COMPLETED';
  payoutData.completedAt = now();
  state.steps = state.steps.map((s, i) =>
    i === 5
      ? { ...s, status: 'completed', data: { ...payoutData }, timestamp: now() }
      : s,
  );
  onUpdate(state);
  return state;
}

export async function runCompletion(
  onUpdate: (state: SimulationState) => void,
  state: SimulationState,
): Promise<SimulationState> {
  state = { ...state, currentStep: 6 };
  state.steps = state.steps.map((s, i) =>
    i === 6 ? { ...s, status: 'running' } : s,
  );
  onUpdate(state);
  await delay(1000);

  const txData = state.steps[4].data || {};
  const payoutData = state.steps[5].data || {};

  const completionData = {
    transactionId: txData.transactionId,
    finalStatus: 'completed',
    amountSent: `${txData.amount} ${txData.fromCurrency}`,
    amountDelivered: `${payoutData.amount} ETB`,
    beneficiary: txData.beneficiary?.name,
    provider: payoutData.provider,
    providerRef: payoutData.providerRef,
    totalDuration: calculateDuration(state),
    completedAt: now(),
  };

  state.steps = state.steps.map((s, i) =>
    i === 6
      ? { ...s, status: 'completed', data: completionData, timestamp: now() }
      : s,
  );
  state = { ...state, isRunning: false, isComplete: true };
  onUpdate(state);
  return state;
}

function calculateDuration(state: SimulationState): string {
  const first = state.steps[0].timestamp;
  const last = state.steps[5].timestamp;
  if (!first || !last) return '~10s';
  const ms = new Date(last).getTime() - new Date(first).getTime();
  return `${(ms / 1000).toFixed(1)}s`;
}

export async function runFullSimulation(
  onUpdate: (state: SimulationState) => void,
): Promise<SimulationState> {
  let state = createInitialState();
  onUpdate(state);

  state = await runSignup(onUpdate, state);
  state = await runKYC(onUpdate, state);
  state = await runWalletTopup(onUpdate, state);
  state = await runFXCalculation(onUpdate, state);
  state = await runRemittance(onUpdate, state);
  state = await runPartnerPayout(onUpdate, state);
  state = await runCompletion(onUpdate, state);

  return state;
}
