import { ethers } from 'hardhat'
import { DeployFunction } from 'hardhat-deploy/types'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeploymentManager } from '../deployment-manager/DeploymentManager'
import { Logger } from '../utils/logger'
import {
    MAG7_DEPOSIT_INSTANT_SIGNATURES,
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
    const zTokenInitParams = {
        zToken: zMAG7Address,
        zTokenDataFeed: dataFeedAddress,
    }
    const receiversInitParams = {
        tokensReceiver: receivers.tokensReceiver,
        feeReceiver: receivers.feeReceiver,
    }
    const instantInitParams = {
        instantFee: MAG7_LAUNCH.depositInstantFee,
        instantDailyLimit: MAG7_LAUNCH.depositInstantDailyLimit,
    }

    const sanctionsList = config.sanctionsList || ethers.ZeroAddress
    const variationTolerance = MAG7_LAUNCH.variationTolerance
    const minAmount = MAG7_LAUNCH.minAmount
    const minZTokenAmountForFirstDeposit = MAG7_LAUNCH.minFirstDeposit
    const maxSupplyCap = MAG7_LAUNCH.maxSupplyCap

    const zMAG7DepositVault = await ethers.getContractFactory('zMAG7DepositVault')
    const initParams = [
        accessControlAddress,
        zTokenInitParams,
        receiversInitParams,
        instantInitParams,
        sanctionsList,
        variationTolerance,
        minAmount,
        minZTokenAmountForFirstDeposit,
        maxSupplyCap,
    ]
    const initData = zMAG7DepositVault.interface.encodeFunctionData('initialize', initParams)

    const [implementationAddress, proxyAddress] = await deploymentManager.deployContract(
        'zMAG7DepositVault',
        zMAG7DepositVault,
        [],
        initData
    )

    const accessControl = await ethers.getContractAt('ZothAccessControl', accessControlAddress)
    await grantAccessControlRoleIfAuthorized(
        accessControl,
        deployer.address,
        MAG7_ROLES.MINT_OPERATOR,
        proxyAddress,
        'MAG7_MINT_OPERATOR_ROLE'
    )
    if (isLocalNetwork(network.name)) {
        await grantAccessControlRoleIfAuthorized(
            accessControl,
            deployer.address,
            MAG7_ROLES.DEPOSIT_VAULT_ADMIN,
            deployer.address,
            'MAG7_DEPOSIT_VAULT_ADMIN_ROLE'
        )
    }

    const vault = await ethers.getContractAt('zMAG7DepositVault', proxyAddress)
    const usdcAddress = await getOrDeployPaymentToken(hre, network.name)
    const paymentTokens = await vault.getPaymentTokens()
    const deployerIsVaultAdmin = await accessControl.hasRole(MAG7_ROLES.DEPOSIT_VAULT_ADMIN, deployer.address)

    if (!paymentTokens.map((t: string) => t.toLowerCase()).includes(usdcAddress.toLowerCase())) {
        if (deployerIsVaultAdmin) {
            Logger.log('Adding USDC payment token', usdcAddress, 1)
            const addTokenTx = await vault.addPaymentToken(
                usdcAddress,
                dataFeedAddress,
                MAG7_LAUNCH.depositTokenFee,
                MAG7_LAUNCH.depositTokenAllowance,
                true
            )
            await addTokenTx.wait()
            Logger.success('USDC added as payment token', '0% fee, stable', 1)
        } else {
            Logger.warning(
                'Skipping addPaymentToken — deployer is not MAG7 deposit vault admin. See out/mag7-role-grants-<network>.json',
                undefined,
                1
            )
        }
    } else {
        Logger.info('USDC already added as payment token', undefined, 1)
    }

    // zOPAL keeps depositInstant live. MAG7 users deposit via depositRequest;
    // MAG7 deposit vault admin later approveRequest. Pause both instant overloads.
    for (const signature of MAG7_DEPOSIT_INSTANT_SIGNATURES) {
        const selector = vault.interface.getFunction(signature).selector
        const alreadyPaused = await vault.fnPaused(selector)
        if (alreadyPaused) {
            Logger.info(`${signature} already paused`, undefined, 1)
            continue
        }
        if (deployerIsVaultAdmin) {
            Logger.log('Pausing instant deposit', signature, 1)
            const pauseTx = await vault.pauseFn(selector)
            await pauseTx.wait()
            Logger.success('Instant deposit paused', signature, 1)
        } else {
            Logger.warning(
                `Skipping pauseFn(${signature}) — deployer is not MAG7 deposit vault admin. See out/mag7-role-grants-<network>.json`,
                undefined,
                1
            )
        }
    }

    Logger.log('Min Amount', ethers.formatEther(await vault.minAmount()), 2)
    Logger.log('Min First Deposit', ethers.formatEther(await vault.minZTokenAmountForFirstDeposit()), 2)
    Logger.log('Max Supply Cap', ethers.formatEther(await vault.maxSupplyCap()), 2)

    await deploymentManager.verifyContract(
        'zMAG7DepositVault',
        [implementationAddress, proxyAddress],
        [],
        initData
    )
    await deploymentManager.verifyOnTenderly('zMAG7DepositVault', [implementationAddress, proxyAddress])

    Logger.deploymentSuccess('zMAG7DepositVault', proxyAddress)
    return true
}

export default func
func.tags = ['zMAG7DepositVault', 'MAG7']
func.id = 'deploy_zmag7_deposit_vault'
func.dependencies = ['ZothAccessControl', 'MAG7Confirm', 'zMAG7', 'MAG7PriceOracle']
