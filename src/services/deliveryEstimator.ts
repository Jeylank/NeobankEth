export type DeliveryCategory = 'Instant' | 'Fast' | 'Standard';

export interface DeliveryEstimate {
  minMinutes: number;
  maxMinutes: number;
  label: DeliveryCategory;
  icon: string;
}

interface ProviderMethodConfig {
  minMinutes: number;
  maxMinutes: number;
  label: DeliveryCategory;
  icon: string;
}

const DELIVERY_TIMES: Record<string, Record<string, ProviderMethodConfig>> = {
  telebirr: {
    mobile_wallet: { minMinutes: 0, maxMinutes: 2, label: 'Instant', icon: 'flash-outline' },
    bank_transfer: { minMinutes: 2, maxMinutes: 10, label: 'Fast', icon: 'time-outline' },
    cash_pickup: { minMinutes: 5, maxMinutes: 30, label: 'Standard', icon: 'walk-outline' },
  },
  cbe: {
    mobile_wallet: { minMinutes: 2, maxMinutes: 5, label: 'Fast', icon: 'flash-outline' },
    bank_transfer: { minMinutes: 2, maxMinutes: 10, label: 'Fast', icon: 'time-outline' },
    cash_pickup: { minMinutes: 5, maxMinutes: 30, label: 'Standard', icon: 'walk-outline' },
  },
  awash: {
    mobile_wallet: { minMinutes: 2, maxMinutes: 5, label: 'Fast', icon: 'flash-outline' },
    bank_transfer: { minMinutes: 2, maxMinutes: 10, label: 'Fast', icon: 'time-outline' },
    cash_pickup: { minMinutes: 5, maxMinutes: 30, label: 'Standard', icon: 'walk-outline' },
  },
  dashen: {
    mobile_wallet: { minMinutes: 2, maxMinutes: 5, label: 'Fast', icon: 'flash-outline' },
    bank_transfer: { minMinutes: 2, maxMinutes: 10, label: 'Fast', icon: 'time-outline' },
    cash_pickup: { minMinutes: 5, maxMinutes: 30, label: 'Standard', icon: 'walk-outline' },
  },
  abyssinia: {
    mobile_wallet: { minMinutes: 2, maxMinutes: 5, label: 'Fast', icon: 'flash-outline' },
    bank_transfer: { minMinutes: 2, maxMinutes: 10, label: 'Fast', icon: 'time-outline' },
    cash_pickup: { minMinutes: 5, maxMinutes: 30, label: 'Standard', icon: 'walk-outline' },
  },
};

const DEFAULT_ESTIMATES: Record<string, ProviderMethodConfig> = {
  mobile_wallet: { minMinutes: 0, maxMinutes: 2, label: 'Instant', icon: 'flash-outline' },
  bank_transfer: { minMinutes: 2, maxMinutes: 10, label: 'Fast', icon: 'time-outline' },
  cash_pickup: { minMinutes: 5, maxMinutes: 30, label: 'Standard', icon: 'walk-outline' },
};

const FALLBACK_ESTIMATE: ProviderMethodConfig = {
  minMinutes: 5,
  maxMinutes: 30,
  label: 'Standard',
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
