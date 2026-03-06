import { ethers } from 'hardhat'
import { DeployFunction } from 'hardhat-deploy/types'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeploymentManager } from '../deployment-manager/DeploymentManager'
import { Logger } from '../utils/logger'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { network } = hre

    // Initialize deployment manager
    const deploymentManager = new DeploymentManager(network.name, hre);
    await deploymentManager.initialize();

    // Get config from manager
    const config = await deploymentManager.getConfig()

    // Get required contract addresses
    const accessControlAddress = config.contractAddresses['ZothAccessControl']
    const zOPALAddress = config.contractAddresses['zOPAL']
    const dataFeedAddress = config.contractAddresses['PriceOracle']

    if (!accessControlAddress || !zOPALAddress || !dataFeedAddress) {
        throw new Error(
            'Required contracts not deployed:\n' +
            `  - ZothAccessControl: ${accessControlAddress || 'MISSING'}\n` +
            `  - zOPAL: ${zOPALAddress || 'MISSING'}\n` +
            `  - PriceOracle: ${dataFeedAddress || 'MISSING'}`
        )
    }

    Logger.log('ZothAccessControl', accessControlAddress, 1)
    Logger.log('zOPAL', zOPALAddress, 1)
    Logger.log('PriceOracle', dataFeedAddress, 1)

    // Configuration parameters
    const [deployer] = await ethers.getSigners()

    const zTokenInitParams = {
        zToken: zOPALAddress,
        zTokenDataFeed: dataFeedAddress,
    }

    const receiversInitParams = {
        tokensReceiver: config.tokensReceiver || deployer.address,
        feeReceiver: config.feeReceiver || deployer.address,
    }

    const instantInitParams = {
        instantFee: 50, // 0.5%
        instantDailyLimit: ethers.parseEther('1000000'),
    }

    const sanctionsList = config.sanctionsList || ethers.ZeroAddress
    const variationTolerance = 200 // 2%
    const minAmount = ethers.parseEther('1')

    const fiatRedemptionInitParams = {
        fiatAdditionalFee: 100, // 1%
        fiatFlatFee: ethers.parseEther('10'), // 10 zToken
        minFiatRedeemAmount: ethers.parseEther('100'),
    }

    const requestRedeemer = config.requestRedeemer || deployer.address

    Logger.log('Configuration:', '', 1)
    Logger.log('Tokens Receiver', receiversInitParams.tokensReceiver, 2)
    Logger.log('Fee Receiver', receiversInitParams.feeReceiver, 2)
    Logger.log('Instant Fee', (instantInitParams.instantFee / 100) + '%', 2)
    Logger.log('Daily Limit', ethers.formatEther(instantInitParams.instantDailyLimit) + ' USD', 2)
    Logger.log('Variation Tolerance', (variationTolerance / 100) + '%', 2)
    Logger.log('Min Amount', ethers.formatEther(minAmount) + ' zToken', 2)
    Logger.log('Fiat Additional Fee', (fiatRedemptionInitParams.fiatAdditionalFee / 100) + '%', 2)
    Logger.log('Fiat Flat Fee', ethers.formatEther(fiatRedemptionInitParams.fiatFlatFee) + ' zToken', 2)
    Logger.log('Min Fiat Redeem Amount', ethers.formatEther(fiatRedemptionInitParams.minFiatRedeemAmount) + ' zToken', 2)
    Logger.log('Request Redeemer', requestRedeemer, 2)

    // Get the contract factory
    const RedemptionVault = await ethers.getContractFactory('RedemptionVault')

    // Prepare initialization parameters
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

    // Encode initializer
    const initData = RedemptionVault.interface.encodeFunctionData(
        'initialize',
        initParams
    )

    // Deploy the contract
    const [implementationAddress, proxyAddress] = await deploymentManager.deployContract(
        'RedemptionVault',
        RedemptionVault,
        [],
        initData
    )

    // Grant burn role to vault (essential for vault to function)
    const ZothAccessControl = await ethers.getContractAt('ZothAccessControl', accessControlAddress)
    const ZOPAL_BURN_OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ZOPAL_BURN_OPERATOR_ROLE'))

    const vaultHasBurnRole = await ZothAccessControl.hasRole(ZOPAL_BURN_OPERATOR_ROLE, proxyAddress)
    if (!vaultHasBurnRole) {
        const tx = await ZothAccessControl.grantRole(ZOPAL_BURN_OPERATOR_ROLE, proxyAddress)
        await tx.wait()
        Logger.success('BURN_OPERATOR_ROLE granted to vault', undefined, 1)
    } else {
        Logger.info('Vault already has BURN_OPERATOR_ROLE', undefined, 1)
    }

    // Verify deployment
    const vault = await ethers.getContractAt('RedemptionVault', proxyAddress)
    const vaultAccessControl = await vault.accessControl()
    const vaultZToken = await vault.zToken()
    const vaultMinAmount = await vault.minAmount()
    const vaultMinFiatRedeemAmount = await vault.minFiatRedeemAmount()
    const vaultRequestRedeemer = await vault.requestRedeemer()

    Logger.log('Verification:', '', 1)
    Logger.log('Access Control matches', (vaultAccessControl.toLowerCase() === accessControlAddress.toLowerCase()).toString(), 2)
    Logger.log('zToken matches', (vaultZToken.toLowerCase() === zOPALAddress.toLowerCase()).toString(), 2)
    Logger.log('Min Amount', ethers.formatEther(vaultMinAmount), 2)
    Logger.log('Min Fiat Redeem Amount', ethers.formatEther(vaultMinFiatRedeemAmount), 2)
    Logger.log('Request Redeemer', vaultRequestRedeemer, 2)

    // Verify the contract on live networks
    await deploymentManager.verifyContract(
        'RedemptionVault',
        [implementationAddress, proxyAddress],
        [],
        initData
    )
    await deploymentManager.verifyOnTenderly('RedemptionVault', [implementationAddress, proxyAddress])

    Logger.deploymentSuccess('RedemptionVault', proxyAddress)

    return true
}

export default func
func.tags = ['RedemptionVault']
func.id = 'deploy_zopal_redemption_vault'
func.dependencies = ['ZothAccessControl', 'zOPAL', 'PriceOracle']
