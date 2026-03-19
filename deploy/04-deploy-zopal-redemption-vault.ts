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
        instantFee: 1000, // 10%
        instantDailyLimit: 0n, // disabled
    }

    const sanctionsList = config.sanctionsList || ethers.ZeroAddress
    const variationTolerance = 1 // 0.01% (1 basis point)
    const minAmount = ethers.parseEther('0.0001') // 0.0001 zToken minimum

    // Fiat redemption disabled - set to 0 values
    const fiatRedemptionInitParams = {
        fiatAdditionalFee: 0, // 0% (disabled)
        fiatFlatFee: ethers.parseEther('0'), // 0 zToken (disabled)
        minFiatRedeemAmount: ethers.parseEther('0'), // 0 (disabled)
    }

    const requestRedeemer = config.requestRedeemer || deployer.address

    Logger.log('Configuration:', undefined, 1)
    Logger.log('  Tokens Receiver', receiversInitParams.tokensReceiver, 1)
    Logger.log('  Fee Receiver', receiversInitParams.feeReceiver, 1)
    Logger.log('  Instant Fee', (instantInitParams.instantFee / 100) + '%', 1)
    Logger.log('  Daily Limit', instantInitParams.instantDailyLimit === 0n ? 'disabled' : ethers.formatEther(instantInitParams.instantDailyLimit) + ' USD', 1)
    Logger.log('  Variation Tolerance', (variationTolerance / 100) + '%', 1)
    Logger.log('  Min Amount', ethers.formatEther(minAmount) + ' zToken', 1)
    Logger.log('  Fiat Additional Fee', (fiatRedemptionInitParams.fiatAdditionalFee / 100) + '%', 1)
    Logger.log('  Fiat Flat Fee', ethers.formatEther(fiatRedemptionInitParams.fiatFlatFee) + ' zToken', 1)
    Logger.log('  Min Fiat Redeem Amount', ethers.formatEther(fiatRedemptionInitParams.minFiatRedeemAmount) + ' zToken', 1)
    Logger.log('  Request Redeemer', requestRedeemer, 1)

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

    // ========== Add USDC Payment Token ==========
    const vault = await ethers.getContractAt('RedemptionVault', proxyAddress)
    
    // USDC on Base mainnet
    const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
    const paymentTokens = await vault.getPaymentTokens()
    
    if (!paymentTokens.map((t: string) => t.toLowerCase()).includes(USDC_ADDRESS.toLowerCase())) {
        Logger.log('Adding USDC payment token', USDC_ADDRESS, 1)
        const addTokenTx = await vault.addPaymentToken(
            USDC_ADDRESS,           // token
            dataFeedAddress,        // dataFeed (not used for stablecoins, but must be non-zero)
            10,                     // tokenFee: 0.10% (10 basis points)
            true                    // stable: true (uses 1:1 rate)
        )
        await addTokenTx.wait()
        Logger.success('USDC added as payment token', '0.10% fee, stable', 1)
    } else {
        Logger.info('USDC already added as payment token', undefined, 1)
    }

    // Verify deployment
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
    Logger.log('Payment Tokens', (await vault.getPaymentTokens()).length.toString(), 2)

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
