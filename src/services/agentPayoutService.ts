import axios from 'axios';
import { secureStorage } from '../utils/storage';
import { API_BASE_URL } from './api';

const EXPO_PUBLIC_API_KEY = process.env.EXPO_PUBLIC_API_KEY?.trim() ?? '';

const agentApi = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

agentApi.interceptors.request.use(async (config) => {
  const token = await secureStorage.getItemAsync('authToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (EXPO_PUBLIC_API_KEY) {
    config.headers['X-API-Key'] = EXPO_PUBLIC_API_KEY;
  }
  return config;
});

export type AgentStatus = 'online' | 'offline';
export type AssignmentStatus = 'assigned' | 'accepted' | 'rejected' | 'timed_out' | 'completed';
export type TransferState =
  | 'PAYMENT_PENDING' | 'FUNDS_RECEIVED' | 'AGENT_ASSIGNED' | 'OTP_SENT'
  | 'READY_FOR_PAYOUT' | 'PAID_OUT' | 'COMPLETED' | 'FAILED' | 'TIMED_OUT'
  | 'UNKNOWN';

export interface Agent {
  id: string;
  full_name: string;
  phone: string;
  city: string;
  status: AgentStatus;
  available_float: number;
  score: number;
  created_at: string;
}

export interface AgentAssignment {
  assignment_id: string;
  transfer_id: string;
  assignment_status: AssignmentStatus;
  transfer_status: TransferState;
  amount: number | null;
  currency: string | null;
  created_at: string;
  updated_at: string;
}

export const agentPayoutApi = {
  listAgents: async (city?: string): Promise<Agent[]> => {
    const response = await agentApi.get('/api/v1/agents', { params: city ? { city } : undefined });
    return response.data.agents;
  },

  getAssignments: async (agentId: string): Promise<AgentAssignment[]> => {
    const response = await agentApi.get(`/api/v1/agents/${agentId}/assignments`);
    return response.data.assignments;
  },

  sendOtp: async (transferId: string): Promise<{ expiresAt: string; otp?: string }> => {
    const response = await agentApi.post(`/api/v1/transfers/${transferId}/send-otp`);
    return response.data;
  },

  verifyOtp: async (transferId: string, otp: string): Promise<{ payout_token: string }> => {
    const response = await agentApi.post('/api/v1/payouts/verify-otp', { transfer_id: transferId, otp });
    return response.data;
  },

  markPaid: async (transferId: string, payoutToken: string): Promise<{ transfer: { id: string; status: string; amount: number; currency: string } }> => {
    const response = await agentApi.post('/api/v1/payouts/mark-paid', { transfer_id: transferId, payout_token: payoutToken });
    return response.data;
  },
};
