import { ethers } from 'hardhat'
import { DeployFunction } from 'hardhat-deploy/types'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeploymentManager } from '../deployment-manager/DeploymentManager'
import { Logger } from '../utils/logger'
import {
    MAG7_LAUNCH,
    MAG7_ROLES,
    ensureSharedProxyAdmin,
    getMag7VaultReceivers,
    getOrDeployPaymentToken,
    grantAccessControlRoleIfAuthorized,
    isLocalNetwork,
    requireAccessControl,
} from './lib/mag7'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { network } = hre

    const deploymentManager = new DeploymentManager(network.name, hre)
    await deploymentManager.initialize()
    const config = await deploymentManager.getConfig()
    const [deployer] = await ethers.getSigners()

    const accessControlAddress = requireAccessControl(config)
    const zMAG7Address = config.contractAddresses['zMAG7']
    const dataFeedAddress = config.contractAddresses['MAG7PriceOracle']

    if (!zMAG7Address || !dataFeedAddress) {
        throw new Error(
            'Required MAG7 contracts not deployed:\n' +
                `  - zMAG7: ${zMAG7Address || 'MISSING'}\n` +
                `  - MAG7PriceOracle: ${dataFeedAddress || 'MISSING'}`
        )
    }

    Logger.log('ZothAccessControl', accessControlAddress, 1)
    Logger.log('zMAG7', zMAG7Address, 1)
    Logger.log('MAG7PriceOracle', dataFeedAddress, 1)

    const proxyAdminAddress = await ensureSharedProxyAdmin(deploymentManager, config, network.name)
    Logger.log('Shared ProxyAdmin', proxyAdminAddress, 1)

    const receivers = getMag7VaultReceivers(config, deployer.address, network.name)
    Logger.log('MAG7 tokensReceiver', receivers.tokensReceiver, 1)
    Logger.log('MAG7 feeReceiver', receivers.feeReceiver, 1)
    Logger.log('MAG7 requestRedeemer', receivers.requestRedeemer, 1)
    const zTokenInitParams = {
        zToken: zMAG7Address,
        zTokenDataFeed: dataFeedAddress,
    }
    const receiversInitParams = {
        tokensReceiver: receivers.tokensReceiver,
        feeReceiver: receivers.feeReceiver,
    }
    const instantInitParams = {
        instantFee: MAG7_LAUNCH.redemptionInstantFee,
        instantDailyLimit: MAG7_LAUNCH.redemptionInstantDailyLimit,
    }
    const sanctionsList = config.sanctionsList || ethers.ZeroAddress
    const variationTolerance = MAG7_LAUNCH.variationTolerance
    const minAmount = MAG7_LAUNCH.minAmount
    const fiatRedemptionInitParams = {
        fiatAdditionalFee: 0,
        fiatFlatFee: ethers.parseEther('0'),
        minFiatRedeemAmount: ethers.parseEther('0'),
    }
    const requestRedeemer = receivers.requestRedeemer

    const zMAG7RedemptionVault = await ethers.getContractFactory('zMAG7RedemptionVault')
    const initParams = [
        accessControlAddress,
        zTokenInitParams,
        receiversInitParams,
        instantInitParams,
        sanctionsList,
        variationTolerance,
        minAmount,
        fiatRedemptionInitParams,
        requestRedeemer,
    ]
    const initData = zMAG7RedemptionVault.interface.encodeFunctionData('initialize', initParams)

    const [implementationAddress, proxyAddress] = await deploymentManager.deployContract(
        'zMAG7RedemptionVault',
        zMAG7RedemptionVault,
        [],
        initData
    )

    const accessControl = await ethers.getContractAt('ZothAccessControl', accessControlAddress)
    await grantAccessControlRoleIfAuthorized(
        accessControl,
        deployer.address,
        MAG7_ROLES.BURN_OPERATOR,
        proxyAddress,
        'MAG7_BURN_OPERATOR_ROLE'
    )
    if (isLocalNetwork(network.name)) {
        await grantAccessControlRoleIfAuthorized(
            accessControl,
            deployer.address,
            MAG7_ROLES.REDEMPTION_VAULT_ADMIN,
            deployer.address,
            'MAG7_REDEMPTION_VAULT_ADMIN_ROLE'
        )
    }

    const vault = await ethers.getContractAt('zMAG7RedemptionVault', proxyAddress)
    const usdcAddress = await getOrDeployPaymentToken(hre, network.name)
    const paymentTokens = await vault.getPaymentTokens()
    const deployerIsVaultAdmin = await accessControl.hasRole(
        MAG7_ROLES.REDEMPTION_VAULT_ADMIN,
        deployer.address
    )

    if (!paymentTokens.map((t: string) => t.toLowerCase()).includes(usdcAddress.toLowerCase())) {
        if (deployerIsVaultAdmin) {
            Logger.log('Adding USDC payment token', usdcAddress, 1)
            const addTokenTx = await vault.addPaymentToken(
                usdcAddress,
                dataFeedAddress,
                MAG7_LAUNCH.redemptionTokenFee,
                true
            )
            await addTokenTx.wait()
            Logger.success('USDC added as payment token', '0.10% fee, stable', 1)
        } else {
            Logger.warning(
                'Skipping addPaymentToken — deployer is not MAG7 redemption vault admin. See out/mag7-role-grants-<network>.json',
                undefined,
                1
            )
        }
    } else {
        Logger.info('USDC already added as payment token', undefined, 1)
    }

    const redeemInstantSelector = vault.interface.getFunction('redeemInstant').selector
    const isInstantPaused = await vault.fnPaused(redeemInstantSelector)
    if (!isInstantPaused) {
        if (deployerIsVaultAdmin) {
            Logger.log('Pausing instant redemption', 'redeemInstant disabled', 1)
            const pauseTx = await vault.pauseFn(redeemInstantSelector)
            await pauseTx.wait()
            Logger.success('Instant redemption paused', undefined, 1)
        } else {
            Logger.warning(
                'Skipping pauseFn(redeemInstant) — deployer is not MAG7 redemption vault admin. See out/mag7-role-grants-<network>.json',
                undefined,
                1
            )
        }
    } else {
        Logger.info('Instant redemption already paused', undefined, 1)
    }

    Logger.log('Min Amount', ethers.formatEther(await vault.minAmount()), 2)
    Logger.log('Request Redeemer', await vault.requestRedeemer(), 2)

    await deploymentManager.verifyContract(
        'zMAG7RedemptionVault',
        [implementationAddress, proxyAddress],
        [],
        initData
    )
    await deploymentManager.verifyOnTenderly('zMAG7RedemptionVault', [implementationAddress, proxyAddress])

    Logger.deploymentSuccess('zMAG7RedemptionVault', proxyAddress)
    return true
}

export default func
func.tags = ['zMAG7RedemptionVault', 'MAG7']
func.id = 'deploy_zmag7_redemption_vault'
func.dependencies = ['ZothAccessControl', 'MAG7Confirm', 'zMAG7', 'MAG7PriceOracle']
