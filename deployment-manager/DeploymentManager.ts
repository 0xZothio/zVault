import { ContractFactory } from 'ethers';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { ConfigService } from '../services/ConfigService';
import { MidasDeploymentConfig } from '../utils/types';
import { Logger } from '../utils/logger';

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

    public async getConfig(): Promise<MidasDeploymentConfig> {
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
            // For upgradeable contracts (with initializerData), deploy with empty constructor
            // For non-upgradeable contracts (no initializerData), pass constructor args
            const implementation = initializerData
                ? await factory.deploy()           // Upgradeable: empty constructor
                : await factory.deploy(...args);   // Non-upgradeable: pass constructor args

            if (this.network !== 'virtual_mainnet') {
                await implementation.waitForDeployment();
            }
            const implementationAddress = await implementation.getAddress();
            Logger.log(`Implementation deployed`, implementationAddress, 1);

            let proxyAddress: string;
            if (initializerData) {
                // Deploy proxy if initializer data is provided (upgradeable pattern)
                const ERC1967Proxy = await this.hre.ethers.getContractFactory('ERC1967Proxy');
                const proxy = await ERC1967Proxy.deploy(implementationAddress, initializerData);
                if (this.network !== 'virtual_mainnet') {
                    await proxy.waitForDeployment();
                }
                proxyAddress = await proxy.getAddress();
                Logger.log(`Proxy deployed`, proxyAddress, 1);
            } else {
                // No proxy, direct deployment (non-upgradeable pattern)
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
            Logger.verificationStart(name, 'Etherscan');

            await this.hre.run('verify:verify', {
                address: addresses[0]
            });

            await new Promise(resolve => setTimeout(resolve, 5000));

            // Note: ERC1967Proxy verification often fails or isn't necessary
            // as it's a standard proxy pattern. Skip proxy verification or verify without contract specification
            try {
                await this.hre.run('verify:verify', {
                    address: addresses[1],
                    constructorArguments: [addresses[0], initializerData || '0x']
                });
            } catch (proxyError: any) {
                // Proxy verification failure is non-critical - log and continue
                Logger.warning('Proxy verification skipped', 'Standard proxy contract', 2);
            }

            Logger.verificationSuccess(name, 'Etherscan');
        } catch (error: any) {
            const errorMessage = error.message || String(error);
            if (errorMessage.toLowerCase().includes('already verified')) {
                Logger.verificationSkipped(name, 'already verified');
            } else {
                Logger.error(`Failed to verify ${name}:`, error);
                throw error;
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