import fs from 'fs/promises';
import path from 'path';
import { DeploymentState } from '../state/DeploymentState';
import { MidasDeploymentConfig } from '../utils/types';
import { Logger } from '../utils/logger';

interface DeploymentConfiguration {
    networks: {
        [network: string]: MidasDeploymentConfig;
    };
    _metadata?: {
        description: string;
        version: string;
        lastUpdated: string;
        instructions: any;
    };
}

interface DeploymentResult extends Omit<MidasDeploymentConfig, 'contractAddresses'> {
    contractAddresses: {
        [key: string]: string;
    };
    deployment: {
        timestamp: string;
        version: string;
        deployer: string;
        network: string;
    };
}

export class ConfigService {
    private static instance: ConfigService;
    private state: DeploymentState;
    private unifiedConfigPath: string;
    private deployedConfigsPath: string;

    private constructor() {
        this.state = DeploymentState.getInstance();
        this.unifiedConfigPath = path.resolve(__dirname, '../config/deployment.json');
        this.deployedConfigsPath = path.resolve(__dirname, '../config/deployed');
    }

    public static getInstance(): ConfigService {
        if (!ConfigService.instance) {
            ConfigService.instance = new ConfigService();
        }
        return ConfigService.instance;
    }

    public async loadConfig(network: string): Promise<MidasDeploymentConfig> {
        try {
            // Load unified configuration
            const deploymentConfiguration = await this.loadDeploymentConfiguration();

            // Get network-specific config
            const networkConfig = deploymentConfiguration.networks[network];
            if (!networkConfig) {
                throw new Error(`Network "${network}" not found in unified config. Available networks: ${Object.keys(deploymentConfiguration.networks).join(', ')}`);
            }

            // Try to load existing deployment data
            const existingDeployment = await this.loadExistingDeployment(network);

            // Merge config with existing deployment addresses
            const finalConfig: MidasDeploymentConfig = {
                ...networkConfig,
                contractAddresses: existingDeployment?.contractAddresses || {}
            };

            // Initialize state
            this.state.initializeNetwork(network, finalConfig);

            // Use the new logger method (only logs once per network)
            Logger.configLoaded(network, !!existingDeployment);

            return finalConfig;
        } catch (error) {
            Logger.error(`Failed to load config for network ${network}:`, error);
            throw error;
        }
    }

    private async loadDeploymentConfiguration(): Promise<DeploymentConfiguration> {
        try {
            const configContent = await fs.readFile(this.unifiedConfigPath, 'utf8');
            const config = JSON.parse(configContent);

            if (!config.networks) {
                throw new Error('Invalid unified config: missing "networks" section');
            }

            return config;
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                throw new Error(`Unified config not found at ${this.unifiedConfigPath}. Please create config/deployment.json`);
            }
            throw error;
        }
    }

    private async loadExistingDeployment(network: string): Promise<DeploymentResult | null> {
        try {
            const deploymentFile = path.join(this.deployedConfigsPath, `${network}.json`);
            const deploymentExists = await fs.access(deploymentFile).then(() => true).catch(() => false);

            if (!deploymentExists) {
                return null;
            }

            const deploymentContent = await fs.readFile(deploymentFile, 'utf8');
            const deployment = JSON.parse(deploymentContent);
            // Removed duplicate logging - now handled by configLoaded method
            return deployment;
        } catch (error: any) {
            Logger.warning(`Could not load existing deployment for ${network}`, error?.message || error);
            return null;
        }
    }

    public async updateAddress(network: string, contractKey: string, address: string): Promise<void> {
        try {
            // Update in-memory state
            this.state.setContractAddress(network, contractKey, address);

            // Persist deployment result
            await this.persistDeploymentResult(network);

            // Use the new logger method for better formatting
            Logger.addressUpdated(contractKey, address, network);
        } catch (error) {
            Logger.error(`Failed to update address for ${contractKey} on ${network}:`, error);
            throw error;
        }
    }

    private async persistDeploymentResult(network: string): Promise<void> {
        try {
            // Ensure deployed configs directory exists
            await fs.mkdir(this.deployedConfigsPath, { recursive: true });

            // Get current network config from state
            const networkConfig = this.state.getNetworkConfig(network);
            if (!networkConfig) {
                throw new Error(`No config found for network ${network}`);
            }

            // Load original config for this network
            const deploymentConfiguration = await this.loadDeploymentConfiguration();
            const originalConfig = deploymentConfiguration.networks[network];
            if (!originalConfig) {
                throw new Error(`Original config not found for network ${network}`);
            }

            // Create deployment result with full details
            const deploymentResult: DeploymentResult = {
                ...originalConfig, // Original configuration parameters
                contractAddresses: Object.fromEntries(
                    Object.entries(networkConfig.contractAddresses).filter(([_, value]) => value !== undefined)
                ) as { [key: string]: string }, // Deployed contract addresses
                deployment: {
                    timestamp: new Date().toISOString(),
                    version: deploymentConfiguration._metadata?.version || '1.0.0',
                    deployer: process.env.DEPLOYER_ADDRESS || 'unknown',
                    network: network
                }
            };

            // Save deployment result
            const deploymentFile = path.join(this.deployedConfigsPath, `${network}.json`);
            await fs.writeFile(deploymentFile, JSON.stringify(deploymentResult, null, 2));

            // More concise logging
            Logger.info(`Deployment result saved to ${network}.json`, undefined, 1);
        } catch (error) {
            Logger.error(`Failed to persist deployment result for network ${network}:`, error);
            throw error;
        }
    }

    public async getNetworkConfig(network: string): Promise<MidasDeploymentConfig | undefined> {
        return this.state.getNetworkConfig(network);
    }

    public async saveNetworkConfig(network: string, config: MidasDeploymentConfig): Promise<void> {
        this.state.initializeNetwork(network, config);
        await this.persistDeploymentResult(network);
    }

    // Utility method to list available networks
    public async getAvailableNetworks(): Promise<string[]> {
        try {
            const deploymentConfiguration = await this.loadDeploymentConfiguration();
            return Object.keys(deploymentConfiguration.networks);
        } catch (error) {
            Logger.error('Failed to get available networks:', error);
            return [];
        }
    }

    // Utility method to get deployment history
    public async getDeploymentHistory(): Promise<{ network: string, deployment: any }[]> {
        try {
            const deployedFiles = await fs.readdir(this.deployedConfigsPath);
            const history = [];

            for (const file of deployedFiles) {
                if (file.endsWith('.json')) {
                    const network = file.replace('.json', '');
                    const deploymentContent = await fs.readFile(
                        path.join(this.deployedConfigsPath, file),
                        'utf8'
                    );
                    const deployment = JSON.parse(deploymentContent);
                    history.push({ network, deployment: deployment.deployment });
                }
            }

            return history.sort((a, b) =>
                new Date(b.deployment.timestamp).getTime() - new Date(a.deployment.timestamp).getTime()
            );
        } catch (error) {
            Logger.error('Failed to get deployment history:', error);
            return [];
        }
    }
}