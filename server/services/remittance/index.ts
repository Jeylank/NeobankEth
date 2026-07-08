import type { IRemittanceProvider } from './IRemittanceProvider';
import { ProductionProvider } from './ProductionProvider';
import { SimulationProvider } from './SimulationProvider';

export type AppMode = 'simulation' | 'production';
export type AppEnvironment = Readonly<{ APP_MODE?: string }>;

export function getAppMode(
  environment: AppEnvironment = process.env as unknown as AppEnvironment,
): AppMode {
  return environment.APP_MODE === 'production' ? 'production' : 'simulation';
}

export interface RemittanceProviderDependencies {
  simulation?: IRemittanceProvider;
  production?: IRemittanceProvider;
}

export function createRemittanceProvider(
  environment: AppEnvironment = process.env as unknown as AppEnvironment,
  dependencies: RemittanceProviderDependencies = {},
): IRemittanceProvider {
  if (getAppMode(environment) === 'production') {
    return dependencies.production ?? new ProductionProvider();
  }
  return dependencies.simulation ?? new SimulationProvider();
}

export const remittanceProvider = createRemittanceProvider();

export type { IRemittanceProvider, RemittanceRequest, RemittanceResponse } from './IRemittanceProvider';
export { ProductionProvider } from './ProductionProvider';
export { SimulationProvider } from './SimulationProvider';
