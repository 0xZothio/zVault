import { ContractAddresses, ZothDeploymentConfig } from '../utils/types';

export interface NetworkConfig {
    [network: string]: ZothDeploymentConfig
}

export class DeploymentState {
    private static instance: DeploymentState;
    private networkStates: Map<string, ZothDeploymentConfig> = new Map();

    private constructor() { }

    public static getInstance(): DeploymentState {
        if (!DeploymentState.instance) {
            DeploymentState.instance = new DeploymentState();
        }
        return DeploymentState.instance;
    }

    public initializeNetwork(network: string, config: ZothDeploymentConfig): void {
        this.networkStates.set(network, { ...config });
    }

    public getNetworkConfig(network: string): ZothDeploymentConfig | undefined {
        return this.networkStates.get(network);
    }

    public setContractAddress(network: string, contractKey: string, address: string): void {
        const config = this.networkStates.get(network);
        if (!config) {
            throw new Error(`Network ${network} not initialized`);
        }

        config.contractAddresses[contractKey] = address;
        this.networkStates.set(network, config);
    }

    public getContractAddress(network: string, contractKey: string): string | undefined {
        return this.networkStates.get(network)?.contractAddresses[contractKey];
    }

    public getAllContractAddresses(network: string): ContractAddresses | undefined {
        return this.networkStates.get(network)?.contractAddresses;
    }

    public getFullState(): NetworkConfig {
        const state: NetworkConfig = {};
        this.networkStates.forEach((config, network) => {
            state[network] = { ...config };
        });
        return state;
    }
} 