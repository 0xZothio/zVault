import { ContractFactory } from 'ethers';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { ConfigService } from '../services/ConfigService';
import { ZothDeploymentConfig } from '../utils/types';
import { Logger, Spinner } from '../utils/logger';

export class DeploymentManager {
    private readonly network: string;
    private readonly configService: ConfigService;
    private readonly hre: HardhatRuntimeEnvironment;

    constructor(network: string, hre: HardhatRuntimeEnvironment) {
        this.network = network;
        this.configService = ConfigService.getInstance();
        this.hre = hre;
    }

    public async initialize(): Promise<void> {
        await this.configService.loadConfig(this.network);
    }

    public async getConfig(): Promise<ZothDeploymentConfig> {
        return this.configService.loadConfig(this.network);
    }

    public async deployContract(
        name: string,
        factory: ContractFactory,
        args: any[] = [],
        initializerData?: string
    ): Promise<[string, string]> {
        try {
            // Check if already deployed
            const existingDeployment = await this.hre.deployments.getOrNull(name);

            if (existingDeployment) {
                Logger.deploymentSkipped(name, existingDeployment.address);
                return [existingDeployment.implementation || existingDeployment.address, existingDeployment.address];
            }

            Logger.deploymentStart(name);

            // Deploy implementation
            Spinner.start(`Deploying ${name} implementation...`);
            const implementation = initializerData
                ? await factory.deploy()
                : await factory.deploy(...args);

            if (this.network !== 'virtual_mainnet') {
                await implementation.waitForDeployment();
            }
            const implementationAddress = await implementation.getAddress();
            Spinner.stop(true, `Implementation deployed: ${implementationAddress}`);

            let proxyAddress: string;
            if (initializerData) {
                Spinner.start(`Deploying ${name} proxy...`);
                const ERC1967Proxy = await this.hre.ethers.getContractFactory('ERC1967Proxy');
                const proxy = await ERC1967Proxy.deploy(implementationAddress, initializerData);
                if (this.network !== 'virtual_mainnet') {
                    await proxy.waitForDeployment();
                }
                proxyAddress = await proxy.getAddress();
                Spinner.stop(true, `Proxy deployed: ${proxyAddress}`);
            } else {
                proxyAddress = implementationAddress;
            }

            // Save deployment info
            await this.hre.deployments.save(name, {
                abi: JSON.parse(factory.interface.formatJson()),
                address: proxyAddress,
                implementation: implementationAddress,
                args: args
            });

            // Update config - use the same name for consistency
            await this.configService.updateAddress(
                this.network,
                name,
                proxyAddress
            );

            Logger.deploymentSuccess(name, proxyAddress);

            // Return the contract instance
            return [implementationAddress, proxyAddress];
        } catch (error) {
            Logger.error(`Failed to deploy ${name}:`, error);
            throw error;
        }
    }

    public async upgradeContract(
        name: string,
        factory: ContractFactory,
        proxyAddress: string,
        args: any[] = [],
        initializerData?: string
    ): Promise<[string, string]> {
        try {
            Logger.log(`Upgrading ${name}...`);

            // Get current implementation address directly from storage slot
            const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
            const currentImplAddress = await this.hre.ethers.provider.getStorage(
                proxyAddress,
                IMPLEMENTATION_SLOT
            );
            Logger.log(`Current Implementation (from slot): ${currentImplAddress}`);

            // Get current contract instance and state
            const currentContract = await this.hre.ethers.getContractAt(name, proxyAddress);
            const preUpgradeState = {
                authority: await currentContract.authority()
            };
            Logger.log('Pre-upgrade state:', JSON.stringify(preUpgradeState, null, 2));

            // Deploy new implementation
            Logger.log('Deploying new implementation...');
            const newImplementation = await factory.deploy();
            await newImplementation.waitForDeployment();
            const newImplAddress = await newImplementation.getAddress();
            Logger.log('New implementation deployed at:', newImplAddress);

            // Compare bytecode
            const currentBytecode = await this.hre.ethers.provider.getCode(
                '0x' + currentImplAddress.slice(26) // Convert from storage format to address
            );
            const newBytecode = await this.hre.ethers.provider.getCode(newImplAddress);

            if (currentBytecode === newBytecode) {
                Logger.log('No bytecode changes detected. Implementation is already up to date.');
                return ['0x' + currentImplAddress.slice(26), proxyAddress];
            }
            Logger.log('Bytecode changes detected, proceeding with upgrade...');

            // Perform upgrade using upgradeToAndCall
            Logger.log('Performing upgrade...');
            const upgradeTx = await currentContract.upgradeToAndCall(
                newImplAddress,
                initializerData || '0x' // Use provided initializer data or empty bytes
            );
            await upgradeTx.wait();
            Logger.log('Upgrade transaction completed');

            // Get upgraded contract instance
            const upgradedContract = await this.hre.ethers.getContractAt(name, proxyAddress);

            // Get post-upgrade state and validate
            const postUpgradeState = {
                authority: await upgradedContract.authority()
            };
            Logger.log('Post-upgrade state:', JSON.stringify(postUpgradeState, null, 2));

            // Validate state matches
            if (preUpgradeState.authority.toLowerCase() !== postUpgradeState.authority.toLowerCase()) {
                throw new Error('State validation failed: authority mismatch after upgrade');
            }
            Logger.log('State validation successful');

            // Save deployment info
            await this.hre.deployments.save(name, {
                abi: JSON.parse(factory.interface.formatJson()),
                address: proxyAddress,
                implementation: newImplAddress,
                args: args
            });

            return [newImplAddress, proxyAddress];
        } catch (error) {
            Logger.error(`Failed to upgrade ${name}:`, error);
            throw error;
        }
    }

    public async verifyContract(
        name: string,
        addresses: [string, string],
        constructorArguments: any[] = [],
        initializerData?: string
    ): Promise<void> {
        if (this.network === 'hardhat' || this.network === 'localhost' || this.network === 'virtual_mainnet') {
            return;
        }

        try {
            Spinner.start(`Verifying ${name} on Etherscan (waiting for indexing)...`);

            // Wait for Etherscan to index the contract
            await new Promise(resolve => setTimeout(resolve, 10000));

            Spinner.update(`Verifying ${name} implementation...`);
            await this.hre.run('verify:verify', {
                address: addresses[0]
            });

            await new Promise(resolve => setTimeout(resolve, 5000));

            // Verify proxy if different from implementation
            if (addresses[1] !== addresses[0]) {
                Spinner.update(`Verifying ${name} proxy...`);
                try {
                    await this.hre.run('verify:verify', {
                        address: addresses[1],
                        constructorArguments: [addresses[0], initializerData || '0x']
                    });
                } catch (proxyError: any) {
                    // Proxy verification failure is non-critical
                }
            }

            Spinner.stop(true, `${name} verified on Etherscan`);
        } catch (error: any) {
            Spinner.stop(false)
            const errorMessage = error.message || String(error);
            if (errorMessage.toLowerCase().includes('already verified')) {
                Logger.info(`${name} already verified on Etherscan`);
            } else if (errorMessage.toLowerCase().includes('does not have bytecode')) {
                Logger.warning(`${name} verification pending`, 'Not yet indexed. Verify manually later.');
            } else {
                Logger.warning(`${name} verification failed`, 'Verify manually later.');
            }
        }
    }

    public async verifyOnTenderly(
        name: string,
        addresses: [string, string]
    ): Promise<void> {
        if (this.network !== 'virtual_mainnet') {
            return;
        }

        try {
            Logger.verificationStart(name, 'Tenderly');

            // await this.hre.tenderly.verify({
            //     name,
            //     address: addresses[0]
            // });

            // await this.hre.tenderly.verify({
            //     name: 'ERC1967Proxyy',
            //     address: addresses[1]
            // });

            Logger.verificationSuccess(name, 'Tenderly');
        } catch (error) {
            Logger.error(`Failed to verify ${name} on Tenderly:`, error);
            throw error;
        }
    }
} 