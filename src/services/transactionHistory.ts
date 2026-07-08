export type TransactionHistoryState = 'loading' | 'error' | 'empty' | 'ready';

export function getTransactionHistoryState(
  isLoading: boolean,
  isError: boolean,
  transactionCount: number,
): TransactionHistoryState {
  if (isLoading) return 'loading';
  if (isError) return 'error';
  return transactionCount === 0 ? 'empty' : 'ready';
}

export function getApiErrorMessage(error: unknown): string {
  const candidate = error as {
    response?: { data?: { message?: unknown } };
    message?: unknown;
  };
  const serverMessage = candidate?.response?.data?.message;
  if (typeof serverMessage === 'string' && serverMessage.trim()) return serverMessage;
  return 'Unable to load transaction history. Check your connection and try again.';
}
