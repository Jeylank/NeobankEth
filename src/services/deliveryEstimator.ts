export interface DeliveryEstimate {
  label: string;
  minutes: number;
  icon: string;
}

const DELIVERY_TIMES: Record<string, Record<string, DeliveryEstimate>> = {
  telebirr: {
    mobile_wallet: { label: 'Instant (under 1 minute)', minutes: 1, icon: 'flash-outline' },
    bank_transfer: { label: '5-10 minutes', minutes: 10, icon: 'time-outline' },
    cash_pickup: { label: '15 minutes', minutes: 15, icon: 'walk-outline' },
  },
  cbe: {
    mobile_wallet: { label: '2-5 minutes', minutes: 5, icon: 'flash-outline' },
    bank_transfer: { label: '5-10 minutes', minutes: 10, icon: 'time-outline' },
    cash_pickup: { label: '15-30 minutes', minutes: 30, icon: 'walk-outline' },
  },
  awash: {
    mobile_wallet: { label: '2-5 minutes', minutes: 5, icon: 'flash-outline' },
    bank_transfer: { label: '10-15 minutes', minutes: 15, icon: 'time-outline' },
    cash_pickup: { label: '15-30 minutes', minutes: 30, icon: 'walk-outline' },
  },
  dashen: {
    mobile_wallet: { label: '2-5 minutes', minutes: 5, icon: 'flash-outline' },
    bank_transfer: { label: '10-15 minutes', minutes: 15, icon: 'time-outline' },
    cash_pickup: { label: '20-30 minutes', minutes: 30, icon: 'walk-outline' },
  },
  abyssinia: {
    mobile_wallet: { label: '2-5 minutes', minutes: 5, icon: 'flash-outline' },
    bank_transfer: { label: '10-20 minutes', minutes: 20, icon: 'time-outline' },
    cash_pickup: { label: '20-30 minutes', minutes: 30, icon: 'walk-outline' },
  },
};

const DEFAULT_ESTIMATES: Record<string, DeliveryEstimate> = {
  mobile_wallet: { label: '2-5 minutes', minutes: 5, icon: 'flash-outline' },
  bank_transfer: { label: '10-20 minutes', minutes: 20, icon: 'time-outline' },
  cash_pickup: { label: '15-30 minutes', minutes: 30, icon: 'walk-outline' },
};

const FALLBACK_ESTIMATE: DeliveryEstimate = {
  label: '15-30 minutes',
  minutes: 30,
  icon: 'time-outline',
};

export function estimateDeliveryTime(provider: string, payoutMethod: string): DeliveryEstimate {
  const normalizedProvider = provider.toLowerCase().replace(/[\s-]/g, '');
  const normalizedMethod = payoutMethod.toLowerCase().replace(/[\s-]/g, '_');

  const providerTimes = DELIVERY_TIMES[normalizedProvider];
  if (providerTimes) {
    const estimate = providerTimes[normalizedMethod];
    if (estimate) return estimate;
  }

  const defaultEstimate = DEFAULT_ESTIMATES[normalizedMethod];
  if (defaultEstimate) return defaultEstimate;

  return FALLBACK_ESTIMATE;
}
