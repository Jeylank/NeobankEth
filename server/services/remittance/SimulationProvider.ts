import { processRemittance } from '../simulationEngine';
import type { IRemittanceProvider, RemittanceRequest, RemittanceResponse } from './IRemittanceProvider';

/** Preserves the existing Firestore-backed simulation behavior. */
export class SimulationProvider implements IRemittanceProvider {
  async initiate(request: RemittanceRequest): Promise<RemittanceResponse> {
    return processRemittance(request);
  }
}
