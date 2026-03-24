export interface SendAgainPayload {
  recipientName?: string;
  beneficiaryId?: number | string | null;
  amount?: number;
  fromCurrency?: string;
  toCurrency?: string;
  paymentMethod?: string;
  payoutMethod?: string;
  description?: string;
  preferredBank?: string;
  sourceLabel?: string;
}

export function buildSendAgainPayload(transaction: any): SendAgainPayload {
  if (!transaction) return {};

  return {
    recipientName:   transaction.beneficiaryName   ?? transaction.recipientName  ?? undefined,
    beneficiaryId:   transaction.beneficiaryId     ?? transaction.recipientId    ?? null,
    amount:          transaction.amount             ?? undefined,
    fromCurrency:    transaction.fromCurrency       ?? transaction.currency       ?? 'EUR',
    toCurrency:      transaction.toCurrency         ?? 'ETB',
    paymentMethod:   transaction.paymentMethod      ?? 'wallet',
    payoutMethod:    transaction.payoutMethod       ?? 'bank_account',
    description:     transaction.description        ?? undefined,
    preferredBank:   transaction.preferredBank      ?? transaction.bankName       ?? undefined,
    sourceLabel:     transaction.beneficiaryName
                       ? `previous transfer to ${transaction.beneficiaryName}`
                       : 'previous transfer',
  };
}

export function navigateToSendAgain(navigation: any, transaction: any) {
  const payload = buildSendAgainPayload(transaction);
  navigation.navigate('Remittance', {
    prefilled:          true,
    amount:             payload.amount,
    fromCurrency:       payload.fromCurrency,
    toCurrency:         payload.toCurrency,
    paymentMethod:      payload.paymentMethod,
    payoutMethod:       payload.payoutMethod,
    beneficiaryId:      payload.beneficiaryId,
    description:        payload.description,
    preferredBank:      payload.preferredBank,
    selectedRecipient:  payload.recipientName ? { name: payload.recipientName } : undefined,
    prefillSource:      payload.sourceLabel,
  });
}
