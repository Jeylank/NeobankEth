import * as admin from 'firebase-admin';
import { adminDb } from '../firebaseAdmin';
import { AgentPayoutError, assignBestAgent, sendOtp } from './agentPayoutService';
import type { RemittanceRequest, RemittanceResponse } from './remittance/IRemittanceProvider';

interface AgentCashDependencies {
  prepareTransaction(transactionId: string, recipientCity: string | undefined): Promise<void>;
  assignAgent(transactionId: string, city?: string): Promise<{
    assignment: { id: string };
    agent: { id: string; full_name: string };
  }>;
  generateOtp(transactionId: string): Promise<{ otp: string; expiresAt: string }>;
}

const dependencies: AgentCashDependencies = {
  async prepareTransaction(transactionId, recipientCity) {
    await adminDb.collection('sim_transactions').doc(transactionId).update({
      payout_method: 'agent_cash',
      status: 'FUNDS_RECEIVED',
      recipient_city: recipientCity,
      updatedAt: admin.firestore.Timestamp.now(),
    });
  },
  assignAgent: assignBestAgent,
  generateOtp: sendOtp,
};

export function isAgentCashRequest(request: RemittanceRequest): boolean {
  return request.metadata?.payout_method === 'agent_cash';
}

export async function startAgentCashPayout(
  request: RemittanceRequest,
  remittance: RemittanceResponse,
  deps: AgentCashDependencies = dependencies,
): Promise<RemittanceResponse> {
  if (!isAgentCashRequest(request) || !remittance.ok || remittance.status !== 201) return remittance;

  const transactionId = typeof remittance.payload.transactionId === 'string'
    ? remittance.payload.transactionId
    : undefined;
  if (!transactionId) return remittance;

  const city = typeof request.metadata?.recipient_city === 'string'
    ? request.metadata.recipient_city
    : undefined;
  await deps.prepareTransaction(transactionId, city);

  try {
    const { assignment, agent } = await deps.assignAgent(transactionId, city);
    const { otp, expiresAt } = await deps.generateOtp(transactionId);
    return {
      ok: true,
      status: 201,
      payload: {
        ...remittance.payload,
        status: 'OTP_SENT',
        payout_method: 'agent_cash',
        assignmentId: assignment.id,
        agent: { id: agent.id, full_name: agent.full_name },
        otp,
        otpExpiresAt: expiresAt,
        message: 'Agent assigned and OTP dispatched. OTP verification and mark-paid are required.',
      },
    };
  } catch (error: unknown) {
    if (error instanceof AgentPayoutError) {
      return {
        ok: false,
        status: error.httpStatus,
        payload: {
          error: error.code,
          message: error.message,
          transactionId,
          status: 'FUNDS_RECEIVED',
          payout_method: 'agent_cash',
          retryable: error.code === 'NO_ELIGIBLE_AGENT',
        },
      };
    }
    throw error;
  }
}
