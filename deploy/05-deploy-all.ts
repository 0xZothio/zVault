import { ethers } from 'hardhat'
import { DeployFunction } from 'hardhat-deploy/types'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeploymentManager } from '../deployment-manager/DeploymentManager'
import { Logger, Spinner } from '../utils/logger'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { network } = hre

    Logger.banner('ZOTH PROTOCOL - FINALIZATION')

    // Initialize deployment manager to get config
    const deploymentManager = new DeploymentManager(network.name, hre);
    await deploymentManager.initialize();
    const config = await deploymentManager.getConfig()

    const [deployer] = await ethers.getSigners()
    const startBalance = await ethers.provider.getBalance(deployer.address)

    const skipDeployerRoles = config.skipDeployerTokenRoles === true
    const roles = config.roles || {}

    Logger.log('Deployer', deployer.address)
    Logger.log('Network', network.name)
    Logger.log('Mode', skipDeployerRoles ? 'MAINNET' : 'TESTNET')
    Logger.log('Balance', ethers.formatEther(startBalance) + ' ETH')

    if (skipDeployerRoles) {
        Logger.section('Configured Role Recipients')
        Logger.log('DEFAULT_ADMIN', roles.defaultAdmin || '(deployer)')
        Logger.log('DEPOSIT_VAULT_ADMIN', roles.depositVaultAdmin || '(not set)')
        Logger.log('REDEMPTION_VAULT_ADMIN', roles.redemptionVaultAdmin || '(not set)')
        Logger.log('PAUSE_OPERATOR', roles.pauseOperator || '(not set)')
        Logger.log('GREENLIST_OPERATOR', roles.greenlistOperator || '(not set)')
        Logger.log('BLACKLIST_OPERATOR', roles.blacklistOperator || '(not set)')
        Logger.log('PRICE_ADMIN', roles.priceAdmin || '(not set)')
        Logger.log('CONFIG_ROLE', roles.configRole || '(not set)')
    }

    const startTime = Date.now()

    try {
        // Role hashes for ZothAccessControl
        const DEFAULT_ADMIN_ROLE = ethers.ZeroHash
        const ZOPAL_DEPOSIT_VAULT_ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ZOPAL_DEPOSIT_VAULT_ADMIN_ROLE'))
        const REDEMPTION_VAULT_ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes('REDEMPTION_VAULT_ADMIN_ROLE'))
        const ZOPAL_MINT_OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ZOPAL_MINT_OPERATOR_ROLE'))
        const ZOPAL_BURN_OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ZOPAL_BURN_OPERATOR_ROLE'))
        const ZOPAL_PAUSE_OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ZOPAL_PAUSE_OPERATOR_ROLE'))
        const GREENLIST_OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes('GREENLIST_OPERATOR_ROLE'))
        const BLACKLIST_OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes('BLACKLIST_OPERATOR_ROLE'))
        const DEPOSIT_VAULT_ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes('DEPOSIT_VAULT_ADMIN_ROLE'))

        // Role hashes for FunctionsAccessControl
        const PRICE_ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes('PRICE_ADMIN_ROLE'))
        const CONFIG_ROLE = ethers.keccak256(ethers.toUtf8Bytes('CONFIG_ROLE'))

        // Get contract addresses
        const accessControlAddress = config.contractAddresses['ZothAccessControl']
        const functionsAccessControlAddress = config.contractAddresses['FunctionsAccessControl']

        if (!accessControlAddress) {
            throw new Error('ZothAccessControl not found in deployed contracts')
        }

        const accessControl = await ethers.getContractAt('ZothAccessControl', accessControlAddress)

        // Helper function to grant role if not already assigned
        const grantRoleIfNeeded = async (
            contract: any,
            role: string,
            address: string,
            roleName: string
        ) => {
            const alreadyHas = await contract.hasRole(role, address)
            if (!alreadyHas) {
                Spinner.start(`Granting ${roleName} to ${address}...`)
                const tx = await contract.grantRole(role, address)
                await tx.wait()
                Spinner.stop(true, `${roleName} granted to ${address}`)
                return true
            } else {
                Logger.info(`${roleName} already assigned to ${address}`)
                return false
            }
        }

        // Helper function to revoke role if currently assigned
        const revokeRoleIfNeeded = async (
            contract: any,
            role: string,
            address: string,
            roleName: string
        ) => {
            const hasRole = await contract.hasRole(role, address)
            if (hasRole) {
                Spinner.start(`Revoking ${roleName} from deployer...`)
                const tx = await contract.revokeRole(role, address)
                await tx.wait()
                Spinner.stop(true, `${roleName} revoked from deployer`)
                return true
            }
            return false
        }

        if (skipDeployerRoles) {
            // ========== MAINNET MODE: Assign roles from config ==========
            Logger.section('Assigning ZothAccessControl Roles')

            if (roles.depositVaultAdmin && roles.depositVaultAdmin !== '') {
                await grantRoleIfNeeded(accessControl, ZOPAL_DEPOSIT_VAULT_ADMIN_ROLE, roles.depositVaultAdmin, 'ZOPAL_DEPOSIT_VAULT_ADMIN')
            }

            if (roles.redemptionVaultAdmin && roles.redemptionVaultAdmin !== '') {
                await grantRoleIfNeeded(accessControl, REDEMPTION_VAULT_ADMIN_ROLE, roles.redemptionVaultAdmin, 'REDEMPTION_VAULT_ADMIN')
            }

            if (roles.pauseOperator && roles.pauseOperator !== '') {
                await grantRoleIfNeeded(accessControl, ZOPAL_PAUSE_OPERATOR_ROLE, roles.pauseOperator, 'ZOPAL_PAUSE_OPERATOR')
            }

            if (roles.greenlistOperator && roles.greenlistOperator !== '') {
                await grantRoleIfNeeded(accessControl, GREENLIST_OPERATOR_ROLE, roles.greenlistOperator, 'GREENLIST_OPERATOR')
            }

            if (roles.blacklistOperator && roles.blacklistOperator !== '') {
                await grantRoleIfNeeded(accessControl, BLACKLIST_OPERATOR_ROLE, roles.blacklistOperator, 'BLACKLIST_OPERATOR')
            }

            // ========== FunctionsAccessControl Role Assignments ==========
            if (functionsAccessControlAddress) {
                Logger.section('Assigning FunctionsAccessControl Roles')
                const functionsAccessControl = await ethers.getContractAt('FunctionsAccessControl', functionsAccessControlAddress)

                if (roles.priceAdmin && roles.priceAdmin !== '') {
                    await grantRoleIfNeeded(functionsAccessControl, PRICE_ADMIN_ROLE, roles.priceAdmin, 'PRICE_ADMIN')
                }

                if (roles.configRole && roles.configRole !== '') {
                    await grantRoleIfNeeded(functionsAccessControl, CONFIG_ROLE, roles.configRole, 'CONFIG')
                }

                if (roles.defaultAdmin && roles.defaultAdmin !== '') {
                    await grantRoleIfNeeded(functionsAccessControl, DEFAULT_ADMIN_ROLE, roles.defaultAdmin, 'DEFAULT_ADMIN')

                    Logger.section('Revoking FunctionsAccessControl from Deployer')
                    if (roles.priceAdmin !== deployer.address) {
                        await revokeRoleIfNeeded(functionsAccessControl, PRICE_ADMIN_ROLE, deployer.address, 'PRICE_ADMIN')
                    }
                    if (roles.configRole !== deployer.address) {
                        await revokeRoleIfNeeded(functionsAccessControl, CONFIG_ROLE, deployer.address, 'CONFIG')
                    }
                    await revokeRoleIfNeeded(functionsAccessControl, DEFAULT_ADMIN_ROLE, deployer.address, 'DEFAULT_ADMIN')
                }
            }

            // ========== FINAL: Transfer ZothAccessControl Admin ==========
            if (roles.defaultAdmin && roles.defaultAdmin !== '') {
                Logger.section('Transferring ZothAccessControl Admin')

                await grantRoleIfNeeded(accessControl, DEFAULT_ADMIN_ROLE, roles.defaultAdmin, 'DEFAULT_ADMIN')

                Logger.section('Revoking Deployer Roles')

                await revokeRoleIfNeeded(accessControl, ZOPAL_MINT_OPERATOR_ROLE, deployer.address, 'ZOPAL_MINT_OPERATOR')
                await revokeRoleIfNeeded(accessControl, ZOPAL_BURN_OPERATOR_ROLE, deployer.address, 'ZOPAL_BURN_OPERATOR')
                await revokeRoleIfNeeded(accessControl, ZOPAL_PAUSE_OPERATOR_ROLE, deployer.address, 'ZOPAL_PAUSE_OPERATOR')
                await revokeRoleIfNeeded(accessControl, ZOPAL_DEPOSIT_VAULT_ADMIN_ROLE, deployer.address, 'ZOPAL_DEPOSIT_VAULT_ADMIN')
                await revokeRoleIfNeeded(accessControl, DEPOSIT_VAULT_ADMIN_ROLE, deployer.address, 'DEPOSIT_VAULT_ADMIN')
                await revokeRoleIfNeeded(accessControl, REDEMPTION_VAULT_ADMIN_ROLE, deployer.address, 'REDEMPTION_VAULT_ADMIN')
                await revokeRoleIfNeeded(accessControl, GREENLIST_OPERATOR_ROLE, deployer.address, 'GREENLIST_OPERATOR')
                await revokeRoleIfNeeded(accessControl, BLACKLIST_OPERATOR_ROLE, deployer.address, 'BLACKLIST_OPERATOR')
                await revokeRoleIfNeeded(accessControl, DEFAULT_ADMIN_ROLE, deployer.address, 'DEFAULT_ADMIN')

                // Verify
                Logger.section('Verification')
                const deployerStillAdmin = await accessControl.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)
                const newAdminHasRole = await accessControl.hasRole(DEFAULT_ADMIN_ROLE, roles.defaultAdmin)

                if (!deployerStillAdmin) {
                    Logger.success('Deployer no longer has DEFAULT_ADMIN_ROLE')
                } else {
                    Logger.error('Deployer still has DEFAULT_ADMIN_ROLE!')
                }

                if (newAdminHasRole) {
                    Logger.success('New admin has DEFAULT_ADMIN_ROLE')
                } else {
                    Logger.error('New admin does not have DEFAULT_ADMIN_ROLE!')
                }
            } else {
                Logger.warning('No defaultAdmin configured - deployer retains admin!')
            }

            // ========== Transfer ProxyAdmin Ownership ==========
            const proxyAdminAddress = config.contractAddresses['ProxyAdmin']
            if (proxyAdminAddress && roles.defaultAdmin && roles.defaultAdmin !== deployer.address) {
                Logger.section('Transferring ProxyAdmin Ownership')
                const proxyAdmin = await ethers.getContractAt('ProxyAdmin', proxyAdminAddress)
                
                const currentOwner = await proxyAdmin.owner()
                if (currentOwner.toLowerCase() === deployer.address.toLowerCase()) {
                    Spinner.start(`Transferring ProxyAdmin to ${roles.defaultAdmin}...`)
                    const tx = await proxyAdmin.transferOwnership(roles.defaultAdmin)
                    await tx.wait()
                    Spinner.stop(true, `ProxyAdmin ownership transferred to ${roles.defaultAdmin}`)
                } else {
                    Logger.info(`ProxyAdmin already owned by ${currentOwner}`)
                }
            }
        } else {
            Logger.info('Testnet mode - deployer retains all roles')
        }

        // Final summary
        const endTime = Date.now()
        const endBalance = await ethers.provider.getBalance(deployer.address)
        const gasUsed = startBalance - endBalance

        Logger.banner('DEPLOYMENT COMPLETE')

        Logger.summary([
            { label: 'Time', value: ((endTime - startTime) / 1000).toFixed(2) + ' seconds' },
            { label: 'Gas Used', value: ethers.formatEther(gasUsed) + ' ETH' },
            { label: 'Final Balance', value: ethers.formatEther(endBalance) + ' ETH' },
        ])

        Logger.section('Next Steps')
        if (skipDeployerRoles) {
            Logger.log('1. Verify contracts on block explorer')
            Logger.log('2. Set initial price in PriceOracle')
            Logger.log('3. Add payment tokens to vaults')
            Logger.log('4. Configure greenlist if required')
            Logger.log('5. Test deposit/redeem flows')
        } else {
            Logger.log('1. Verify contracts on block explorer')
            Logger.log('2. Configure multi-sig for admin roles')
            Logger.log('3. Add payment tokens to vault')
            Logger.log('4. Test deposit/mint flow')
        }
        Logger.log(`5. Check config/deployed/${network.name}.json`)

    } catch (error) {
        Logger.error('Deployment finalization failed:', error)
        throw error
    }

    return true
}

export default func
func.tags = ['Complete']
func.id = 'deploy_all'
func.dependencies = ['ZothAccessControl', 'zOPAL', 'PriceOracle', 'zOPALDepositVault', 'RedemptionVault']
func.runAtTheEnd = true
