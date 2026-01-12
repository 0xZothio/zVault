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
    const zHyperAddress = config.contractAddresses['zHYPER']
    const dataFeedAddress = config.contractAddresses['PriceOracle']

    if (!accessControlAddress || !zHyperAddress || !dataFeedAddress) {
        throw new Error(
            'Required contracts not deployed:\n' +
            `  - ZothAccessControl: ${accessControlAddress || 'MISSING'}\n` +
            `  - zHYPER: ${zHyperAddress || 'MISSING'}\n` +
            `  - PriceOracle: ${dataFeedAddress || 'MISSING'}`
        )
    }

    Logger.log('ZothAccessControl', accessControlAddress, 1)
    Logger.log('zHYPER', zHyperAddress, 1)
    Logger.log('PriceOracle', dataFeedAddress, 1)

    // Configuration parameters
    const [deployer] = await ethers.getSigners()

    const zTokenInitParams = {
        zToken: zHyperAddress,
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

    // Grant necessary roles
    Logger.log('Setting up roles...', undefined, 1)
    const ZothAccessControl = await ethers.getContractAt(
        'ZothAccessControl',
        accessControlAddress
    )

    const REDEMPTION_VAULT_ADMIN_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes('REDEMPTION_VAULT_ADMIN_ROLE')
    )
    const Z_HYPER_BURN_OPERATOR_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes('Z_HYPER_BURN_OPERATOR_ROLE')
    )

    // Grant vault admin role to deployer
    let tx = await ZothAccessControl.grantRole(
        REDEMPTION_VAULT_ADMIN_ROLE,
        deployer.address
    )
    await tx.wait()
    Logger.success('Vault admin role granted to deployer', undefined, 2)

    // Grant burn role to vault
    tx = await ZothAccessControl.grantRole(
        Z_HYPER_BURN_OPERATOR_ROLE,
        proxyAddress
    )
    await tx.wait()
    Logger.success('Burn role granted to vault', undefined, 2)

    // Verify deployment
    const vault = RedemptionVault.attach(proxyAddress)
    const vaultAccessControl = await vault.accessControl()
    const vaultZToken = await vault.zToken()
    const vaultMinAmount = await vault.minAmount()
    const vaultMinFiatRedeemAmount = await vault.minFiatRedeemAmount()
    const vaultRequestRedeemer = await vault.requestRedeemer()

    Logger.log('Verification:', '', 1)
    Logger.log('Access Control matches', (vaultAccessControl.toLowerCase() === accessControlAddress.toLowerCase()).toString(), 2)
    Logger.log('zToken matches', (vaultZToken.toLowerCase() === zHyperAddress.toLowerCase()).toString(), 2)
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
func.id = 'deploy_zhyper_redemption_vault'
func.dependencies = ['ZothAccessControl', 'zHYPER', 'PriceOracle']

