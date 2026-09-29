import { ethers } from 'hardhat'
import { DeployFunction } from 'hardhat-deploy/types'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeploymentManager } from '../deployment-manager/DeploymentManager'
import { Logger } from '../utils/logger'
import { MAG7_ROLES, SHARED_AC_ROLES, assertProxyUsesSharedAdmin, deployerCanGrantAccessControlRoles, ensureSharedTimelockGovernance, grantAccessControlRoleIfAuthorized, grantRoleIfNeeded, isLocalNetwork, requireAccessControl, writeMag7PostDeployPlan } from './lib/mag7'

/**
 * Grant MAG7 roles and confirm MAG7 proxies use the protocol ProxyAdmin
 * and UpgradeTimelock. Does not transfer shared access-control admin.
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { network } = hre

    Logger.banner('ZMAG7 - ROLE FINALIZATION')

    const deploymentManager = new DeploymentManager(network.name, hre)
    await deploymentManager.initialize()
    const config = await deploymentManager.getConfig()
    const [deployer] = await ethers.getSigners()

    const accessControlAddress = requireAccessControl(config)
    const functionsAccessControlAddress = config.contractAddresses['MAG7FunctionsAccessControl']
    const depositVaultAddress = config.contractAddresses['zMAG7DepositVault']
    const redemptionVaultAddress = config.contractAddresses['zMAG7RedemptionVault']
    const zMAG7Address = config.contractAddresses['zMAG7']
    const proxyAdminAddress = config.contractAddresses['ProxyAdmin']

    if (!depositVaultAddress || !redemptionVaultAddress || !zMAG7Address) {
        throw new Error('zMAG7 token or vaults not deployed')
    }
    if (!proxyAdminAddress) {
        throw new Error('ProxyAdmin not found. MAG7 proxies must use the protocol ProxyAdmin.')
    }

    Logger.section('Shared upgrade stack')
    const timelockAddress = await ensureSharedTimelockGovernance(
        hre,
        network.name,
        config,
        proxyAdminAddress
    )
    await assertProxyUsesSharedAdmin(hre, proxyAdminAddress, zMAG7Address, 'zMAG7')
    await assertProxyUsesSharedAdmin(hre, proxyAdminAddress, depositVaultAddress, 'zMAG7DepositVault')
    await assertProxyUsesSharedAdmin(hre, proxyAdminAddress, redemptionVaultAddress, 'zMAG7RedemptionVault')
    Logger.log('ProxyAdmin', proxyAdminAddress, 1)
    Logger.log('UpgradeTimelock', timelockAddress, 1)

    const accessControl = await ethers.getContractAt('ZothAccessControl', accessControlAddress)
    const mag7Roles = config.mag7Roles || {}
    const assignToMpc = !isLocalNetwork(network.name) && config.skipDeployerTokenRoles === true
    const canGrantAc = await deployerCanGrantAccessControlRoles(accessControl, deployer.address)

    const DEFAULT_ADMIN_ROLE = ethers.ZeroHash
    const PRICE_ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes('PRICE_ADMIN_ROLE'))
    const CONFIG_ROLE = ethers.keccak256(ethers.toUtf8Bytes('CONFIG_ROLE'))

    Logger.log('Mode', assignToMpc ? 'MAINNET (MAG7 MPC roles)' : 'LOCAL (deployer retains MAG7 admin)', 1)
    Logger.log('Shared ZothAccessControl', accessControlAddress, 1)
    Logger.log('Deployer can grant ZothAccessControl roles', canGrantAc.toString(), 1)

    if (canGrantAc) {
        await grantAccessControlRoleIfAuthorized(accessControl, deployer.address, MAG7_ROLES.MINT_OPERATOR, depositVaultAddress, 'MAG7_MINT_OPERATOR → deposit vault')
        await grantAccessControlRoleIfAuthorized(accessControl, deployer.address, MAG7_ROLES.BURN_OPERATOR, redemptionVaultAddress, 'MAG7_BURN_OPERATOR → redemption vault')
    } else {
        Logger.warning('Skipping ZothAccessControl grants — deployer is not DEFAULT_ADMIN. Grants are listed in the post-deploy file.')
    }

    if (assignToMpc && canGrantAc) {
        if (mag7Roles.depositVaultAdmin) {
            await grantAccessControlRoleIfAuthorized(accessControl, deployer.address, MAG7_ROLES.DEPOSIT_VAULT_ADMIN, mag7Roles.depositVaultAdmin, 'MAG7_DEPOSIT_VAULT_ADMIN')
        }
        if (mag7Roles.redemptionVaultAdmin) {
            await grantAccessControlRoleIfAuthorized(accessControl, deployer.address, MAG7_ROLES.REDEMPTION_VAULT_ADMIN, mag7Roles.redemptionVaultAdmin, 'MAG7_REDEMPTION_VAULT_ADMIN')
        }
        if (mag7Roles.pauseOperator) {
            await grantAccessControlRoleIfAuthorized(accessControl, deployer.address, MAG7_ROLES.PAUSE_OPERATOR, mag7Roles.pauseOperator, 'MAG7_PAUSE_OPERATOR')
        }
        if (mag7Roles.greenlistOperator) {
            await grantAccessControlRoleIfAuthorized(accessControl, deployer.address, SHARED_AC_ROLES.GREENLIST_OPERATOR, mag7Roles.greenlistOperator, 'GREENLIST_OPERATOR')
        }
        if (mag7Roles.blacklistOperator) {
            await grantAccessControlRoleIfAuthorized(accessControl, deployer.address, SHARED_AC_ROLES.BLACKLIST_OPERATOR, mag7Roles.blacklistOperator, 'BLACKLIST_OPERATOR')
        }

        Logger.section('Revoking MAG7-only roles from deployer (shared AC admin is left intact)')
        const mag7DeployerRoles = [
            { role: MAG7_ROLES.DEPOSIT_VAULT_ADMIN, name: 'MAG7_DEPOSIT_VAULT_ADMIN' },
            { role: MAG7_ROLES.REDEMPTION_VAULT_ADMIN, name: 'MAG7_REDEMPTION_VAULT_ADMIN' },
            { role: MAG7_ROLES.PAUSE_OPERATOR, name: 'MAG7_PAUSE_OPERATOR' },
            { role: MAG7_ROLES.MINT_OPERATOR, name: 'MAG7_MINT_OPERATOR' },
            { role: MAG7_ROLES.BURN_OPERATOR, name: 'MAG7_BURN_OPERATOR' },
        ]
        for (const { role, name } of mag7DeployerRoles) {
            if (await accessControl.hasRole(role, deployer.address)) {
                const tx = await accessControl.revokeRole(role, deployer.address)
                await tx.wait()
                Logger.success(`Revoked ${name} from deployer`, undefined, 1)
            }
        }

        Logger.warning(
            'Shared ZothAccessControl DEFAULT_ADMIN_ROLE was not transferred. ProxyAdmin remains owned by UpgradeTimelock.'
        )
    } else if (!assignToMpc && canGrantAc) {
        Logger.info('Local mode — deployer keeps MAG7 vault admin / mint-burn grants for testing')
        await grantAccessControlRoleIfAuthorized(accessControl, deployer.address, MAG7_ROLES.DEPOSIT_VAULT_ADMIN, deployer.address, 'MAG7_DEPOSIT_VAULT_ADMIN')
        await grantAccessControlRoleIfAuthorized(accessControl, deployer.address, MAG7_ROLES.REDEMPTION_VAULT_ADMIN, deployer.address, 'MAG7_REDEMPTION_VAULT_ADMIN')
        await grantAccessControlRoleIfAuthorized(accessControl, deployer.address, MAG7_ROLES.PAUSE_OPERATOR, deployer.address, 'MAG7_PAUSE_OPERATOR')
    }

    if (functionsAccessControlAddress) {
        const fac = await ethers.getContractAt('FunctionsAccessControl', functionsAccessControlAddress)
        if (mag7Roles.priceAdmin) {
            await grantRoleIfNeeded(fac, PRICE_ADMIN_ROLE, mag7Roles.priceAdmin, 'MAG7 PRICE_ADMIN')
        }
        if (mag7Roles.configRole) {
            await grantRoleIfNeeded(fac, CONFIG_ROLE, mag7Roles.configRole, 'MAG7 CONFIG')
        }
        if (assignToMpc && mag7Roles.defaultAdmin) {
            await grantRoleIfNeeded(fac, DEFAULT_ADMIN_ROLE, mag7Roles.defaultAdmin, 'MAG7 FunctionsAccessControl DEFAULT_ADMIN')

            Logger.section('Revoking MAG7 FunctionsAccessControl from deployer')
            const revokeIf = async (role: string, name: string) => {
                if (await fac.hasRole(role, deployer.address)) {
                    const tx = await fac.revokeRole(role, deployer.address)
                    await tx.wait()
                    Logger.success(`Revoked ${name} from deployer`, undefined, 1)
                }
            }
            if (mag7Roles.priceAdmin && mag7Roles.priceAdmin.toLowerCase() !== deployer.address.toLowerCase()) {
                await revokeIf(PRICE_ADMIN_ROLE, 'PRICE_ADMIN')
            }
            if (mag7Roles.configRole && mag7Roles.configRole.toLowerCase() !== deployer.address.toLowerCase()) {
                await revokeIf(CONFIG_ROLE, 'CONFIG')
            }
            if (mag7Roles.defaultAdmin.toLowerCase() !== deployer.address.toLowerCase()) {
                await revokeIf(DEFAULT_ADMIN_ROLE, 'DEFAULT_ADMIN')
            }
        }
    }

    const grantFile = await writeMag7PostDeployPlan(
        hre,
        network.name,
        deployer.address,
        accessControlAddress,
        mag7Roles,
        {
            zMAG7: zMAG7Address,
            MAG7PriceOracle: config.contractAddresses['MAG7PriceOracle'] || '',
            MAG7FunctionsAccessControl: functionsAccessControlAddress,
            zMAG7DepositVault: depositVaultAddress,
            zMAG7RedemptionVault: redemptionVaultAddress,
            ProxyAdmin: proxyAdminAddress,
            UpgradeTimelock: timelockAddress,
        },
        config.roles?.defaultAdmin || 'ZothAccessControl DEFAULT_ADMIN_ROLE holder'
    )

    Logger.banner('ZMAG7 DEPLOYMENT COMPLETE')
    Logger.log('zMAG7', zMAG7Address, 1)
    Logger.log('MAG7PriceOracle', config.contractAddresses['MAG7PriceOracle'] || '', 1)
    Logger.log('zMAG7DepositVault', depositVaultAddress, 1)
    Logger.log('zMAG7RedemptionVault', redemptionVaultAddress, 1)
    Logger.log('ProxyAdmin', proxyAdminAddress, 1)
    Logger.log('UpgradeTimelock', timelockAddress, 1)
    Logger.log('Post-deploy grants', grantFile, 1)
    Logger.log(`Saved to config/deployed/${network.name}.json`, undefined, 1)

    return true
}

export default func
func.tags = ['MAG7Complete', 'MAG7']
func.id = 'deploy_zmag7_all'
func.dependencies = ['ZothAccessControl', 'MAG7Confirm', 'zMAG7', 'MAG7PriceOracle', 'zMAG7DepositVault', 'zMAG7RedemptionVault']
func.runAtTheEnd = true
