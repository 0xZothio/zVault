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
    const zeUSDAddress = config.contractAddresses['ZeUSD']
    const dataFeedAddress = config.contractAddresses['PriceOracle']

    if (!accessControlAddress || !zeUSDAddress || !dataFeedAddress) {
        throw new Error(
            'Required contracts not deployed:\n' +
            `  - ZothAccessControl: ${accessControlAddress || 'MISSING'}\n` +
            `  - ZeUSD: ${zeUSDAddress || 'MISSING'}\n` +
            `  - PriceOracle: ${dataFeedAddress || 'MISSING'}`
        )
    }

    Logger.log('ZothAccessControl', accessControlAddress, 1)
    Logger.log('ZeUSD', zeUSDAddress, 1)
    Logger.log('PriceOracle', dataFeedAddress, 1)

    // Configuration parameters
    const [deployer] = await ethers.getSigners()

    const zTokenInitParams = {
        zToken: zeUSDAddress,
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
    const minZTokenAmountForFirstDeposit = ethers.parseEther('1')
    const maxSupplyCap = ethers.parseEther('1000000000')

    Logger.log('Configuration:', '', 1)
    Logger.log('Tokens Receiver', receiversInitParams.tokensReceiver, 2)
    Logger.log('Fee Receiver', receiversInitParams.feeReceiver, 2)
    Logger.log('Instant Fee', (instantInitParams.instantFee / 100) + '%', 2)
    Logger.log('Daily Limit', ethers.formatEther(instantInitParams.instantDailyLimit) + ' USD', 2)
    Logger.log('Variation Tolerance', (variationTolerance / 100) + '%', 2)
    Logger.log('Min Amount', ethers.formatEther(minAmount) + ' USD', 2)
    Logger.log('Min First Deposit', ethers.formatEther(minZTokenAmountForFirstDeposit) + ' USD', 2)
    Logger.log('Max Supply Cap', ethers.formatEther(maxSupplyCap), 2)

    // Get the contract factory
    const ZeUSDDepositVault = await ethers.getContractFactory('ZeUSDDepositVault')

    // Prepare initialization parameters
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

    // Encode initializer
    const initData = ZeUSDDepositVault.interface.encodeFunctionData(
        'initialize',
        initParams
    )

    // Deploy the contract
    const [implementationAddress, proxyAddress] = await deploymentManager.deployContract(
        'ZeUSDDepositVault',
        ZeUSDDepositVault,
        [],
        initData
    )

    // Grant necessary roles
    Logger.log('Setting up roles...', undefined, 1)
    const ZothAccessControl = await ethers.getContractAt(
        'ZothAccessControl',
        accessControlAddress
    )

    const ZEUSD_DEPOSIT_VAULT_ADMIN_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes('ZEUSD_DEPOSIT_VAULT_ADMIN_ROLE')
    )
    const ZEUSD_MINT_OPERATOR_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes('ZEUSD_MINT_OPERATOR_ROLE')
    )

    // Grant vault admin role to deployer
    let tx = await ZothAccessControl.grantRole(
        ZEUSD_DEPOSIT_VAULT_ADMIN_ROLE,
        deployer.address
    )
    await tx.wait()
    Logger.success('Vault admin role granted to deployer', undefined, 2)

    // Grant mint role to vault
    tx = await ZothAccessControl.grantRole(
        ZEUSD_MINT_OPERATOR_ROLE,
        proxyAddress
    )
    await tx.wait()
    Logger.success('Mint role granted to vault', undefined, 2)

    // Verify deployment
    const vault = ZeUSDDepositVault.attach(proxyAddress)
    const vaultAccessControl = await vault.accessControl()
    const vaultZToken = await vault.zToken()
    const vaultMinAmount = await vault.minAmount()
    const vaultMaxSupplyCap = await vault.maxSupplyCap()

    Logger.log('Verification:', '', 1)
    Logger.log('Access Control matches', (vaultAccessControl.toLowerCase() === accessControlAddress.toLowerCase()).toString(), 2)
    Logger.log('zToken matches', (vaultZToken.toLowerCase() === zeUSDAddress.toLowerCase()).toString(), 2)
    Logger.log('Min Amount', ethers.formatEther(vaultMinAmount), 2)
    Logger.log('Max Supply Cap', ethers.formatEther(vaultMaxSupplyCap), 2)

    // Verify the contract on live networks
    await deploymentManager.verifyContract(
        'ZeUSDDepositVault',
        [implementationAddress, proxyAddress],
        [],
        initData
    )
    await deploymentManager.verifyOnTenderly('ZeUSDDepositVault', [implementationAddress, proxyAddress])

    Logger.deploymentSuccess('ZeUSDDepositVault', proxyAddress)

    return true
}

export default func
func.tags = ['ZeUSDDepositVault']
func.id = 'deploy_zeusd_deposit_vault'
func.dependencies = ['ZothAccessControl', 'ZeUSD', 'PriceOracle']
