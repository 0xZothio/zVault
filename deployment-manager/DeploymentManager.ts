import { ContractFactory } from 'ethers';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { ConfigService } from '../services/ConfigService';
import { ZothDeploymentConfig } from '../utils/types';
import { Logger, Spinner } from '../utils/logger';

export class DeploymentManager {
    private readonly network: string;
    private readonly configService: ConfigService;
    private readonly hre: HardhatRuntimeEnvironment;
    private proxyAdminAddress: string | null = null;

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

    /**
     * Deploy or get existing ProxyAdmin
     * ProxyAdmin is the contract that controls all proxy upgrades
     */
    public async deployProxyAdmin(): Promise<string> {
        const config = await this.getConfig();

        // Check if already deployed
        if (config.contractAddresses['ProxyAdmin']) {
            this.proxyAdminAddress = config.contractAddresses['ProxyAdmin'];
            Logger.info('Using existing ProxyAdmin', this.proxyAdminAddress);
            return this.proxyAdminAddress;
        }

        const existingDeployment = await this.hre.deployments.getOrNull('ProxyAdmin');
        if (existingDeployment) {
            this.proxyAdminAddress = existingDeployment.address;
            Logger.info('Using existing ProxyAdmin', this.proxyAdminAddress);
            return this.proxyAdminAddress;
        }

        Logger.deploymentStart('ProxyAdmin');

        Spinner.start('Deploying ProxyAdmin...');
        const ProxyAdmin = await this.hre.ethers.getContractFactory('ProxyAdmin');
        const proxyAdmin = await ProxyAdmin.deploy();

        if (this.network !== 'virtual_mainnet') {
            await proxyAdmin.waitForDeployment();
        }

        this.proxyAdminAddress = await proxyAdmin.getAddress();
        Spinner.stop(true, `ProxyAdmin deployed: ${this.proxyAdminAddress}`);

        // Save deployment
        await this.hre.deployments.save('ProxyAdmin', {
            abi: JSON.parse(ProxyAdmin.interface.formatJson()),
            address: this.proxyAdminAddress,
            args: []
        });

        await this.configService.updateAddress(this.network, 'ProxyAdmin', this.proxyAdminAddress);

        Logger.deploymentSuccess('ProxyAdmin', this.proxyAdminAddress);
        return this.proxyAdminAddress;
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
                // Ensure ProxyAdmin is deployed
                if (!this.proxyAdminAddress) {
                    await this.deployProxyAdmin();
                }

                Spinner.start(`Deploying ${name} proxy (TransparentUpgradeableProxy)...`);
                const TransparentProxy = await this.hre.ethers.getContractFactory('TransparentUpgradeableProxy');
                const proxy = await TransparentProxy.deploy(
                    implementationAddress,
                    this.proxyAdminAddress!,
                    initializerData
                );
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

            // Update config
            await this.configService.updateAddress(this.network, name, proxyAddress);

            Logger.deploymentSuccess(name, proxyAddress);

            return [implementationAddress, proxyAddress];
        } catch (error) {
            Logger.error(`Failed to deploy ${name}:`, error);
            throw error;
        }
    }

    /**
     * Upgrade a contract via ProxyAdmin
     */
    public async upgradeContract(
        name: string,
        factory: ContractFactory,
        proxyAddress: string
    ): Promise<[string, string]> {
        try {
            Logger.section(`Upgrading ${name}`);

            // Get ProxyAdmin
            const config = await this.getConfig();
            const proxyAdminAddress = config.contractAddresses['ProxyAdmin'];
            if (!proxyAdminAddress) {
                throw new Error('ProxyAdmin not found. Cannot upgrade.');
            }

            const proxyAdmin = await this.hre.ethers.getContractAt('ProxyAdmin', proxyAdminAddress);

            // Get current implementation
            const currentImplAddress = await proxyAdmin.getProxyImplementation(proxyAddress);
            Logger.log('Current implementation', currentImplAddress, 1);

            // Deploy new implementation
            Spinner.start(`Deploying new ${name} implementation...`);
            const newImplementation = await factory.deploy();
            await newImplementation.waitForDeployment();
            const newImplAddress = await newImplementation.getAddress();
            Spinner.stop(true, `New implementation: ${newImplAddress}`);

            // Compare bytecode
            const currentBytecode = await this.hre.ethers.provider.getCode(currentImplAddress);
            const newBytecode = await this.hre.ethers.provider.getCode(newImplAddress);

            if (currentBytecode === newBytecode) {
                Logger.info('No bytecode changes. Already up to date.');
                return [currentImplAddress, proxyAddress];
            }

            // Perform upgrade via ProxyAdmin
            Spinner.start('Upgrading proxy...');
            const tx = await proxyAdmin.upgrade(proxyAddress, newImplAddress);
            await tx.wait();
            Spinner.stop(true, 'Upgrade complete');

            // Verify upgrade
            const verifyImplAddress = await proxyAdmin.getProxyImplementation(proxyAddress);
            if (verifyImplAddress.toLowerCase() !== newImplAddress.toLowerCase()) {
                throw new Error('Upgrade verification failed');
            }
            Logger.success('Upgrade verified', newImplAddress);

            // Update deployment info
            await this.hre.deployments.save(name, {
                abi: JSON.parse(factory.interface.formatJson()),
                address: proxyAddress,
                implementation: newImplAddress
            });

            return [newImplAddress, proxyAddress];
        } catch (error) {
            Logger.error(`Failed to upgrade ${name}:`, error);
            throw error;
        }
    }

    /**
     * Upgrade a contract with reinitialization
     */
    public async upgradeContractAndCall(
        name: string,
        factory: ContractFactory,
        proxyAddress: string,
        initializerData: string
    ): Promise<[string, string]> {
        try {
            Logger.section(`Upgrading ${name} with reinitialization`);

            const config = await this.getConfig();
            const proxyAdminAddress = config.contractAddresses['ProxyAdmin'];
            if (!proxyAdminAddress) {
                throw new Error('ProxyAdmin not found. Cannot upgrade.');
            }

            const proxyAdmin = await this.hre.ethers.getContractAt('ProxyAdmin', proxyAdminAddress);

            // Deploy new implementation
            Spinner.start(`Deploying new ${name} implementation...`);
            const newImplementation = await factory.deploy();
            await newImplementation.waitForDeployment();
            const newImplAddress = await newImplementation.getAddress();
            Spinner.stop(true, `New implementation: ${newImplAddress}`);

            // Perform upgrade with call
            Spinner.start('Upgrading proxy with initialization...');
            const tx = await proxyAdmin.upgradeAndCall(proxyAddress, newImplAddress, initializerData);
            await tx.wait();
            Spinner.stop(true, 'Upgrade complete');

            Logger.success('Upgrade verified', newImplAddress);

            await this.hre.deployments.save(name, {
                abi: JSON.parse(factory.interface.formatJson()),
                address: proxyAddress,
                implementation: newImplAddress
            });

            return [newImplAddress, proxyAddress];
        } catch (error) {
            Logger.error(`Failed to upgrade ${name}:`, error);
            throw error;
        }
    }

    /**
     * Transfer ProxyAdmin ownership (for multisig)
     */
    public async transferProxyAdminOwnership(newOwner: string): Promise<void> {
        const config = await this.getConfig();
        const proxyAdminAddress = config.contractAddresses['ProxyAdmin'];
        if (!proxyAdminAddress) {
            throw new Error('ProxyAdmin not found');
        }

        const proxyAdmin = await this.hre.ethers.getContractAt('ProxyAdmin', proxyAdminAddress);

        Spinner.start(`Transferring ProxyAdmin ownership to ${newOwner}...`);
        const tx = await proxyAdmin.transferOwnership(newOwner);
        await tx.wait();
        Spinner.stop(true, `ProxyAdmin ownership transferred to ${newOwner}`);
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
                        constructorArguments: [addresses[0], this.proxyAdminAddress, initializerData || '0x']
                    });
                } catch (proxyError: any) {
                    // Proxy verification often fails, non-critical
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
            Logger.verificationSuccess(name, 'Tenderly');
        } catch (error) {
            Logger.error(`Failed to verify ${name} on Tenderly:`, error);
            throw error;
        }
    }
}
