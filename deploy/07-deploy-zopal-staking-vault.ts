import { ethers } from 'hardhat'
import { DeployFunction } from 'hardhat-deploy/types'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeploymentManager } from '../deployment-manager/DeploymentManager'
import { Logger } from '../utils/logger'

/**
 * Deploy script for zOPAL Staking Vault
 * 
 * The zOPAL Staking Vault accepts USDC deposits from users, locks the capital
 * for a configurable duration (default 6 months), and deploys the deposited
 * USDC into zOPAL vaults to generate yield. Users earn Zocta Points off-chain.
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { network } = hre

    Logger.banner('DEPLOYING zOPAL STAKING VAULT')

    // Initialize deployment manager
    const deploymentManager = new DeploymentManager(network.name, hre)
    await deploymentManager.initialize()

    // Get config from manager
    const config = await deploymentManager.getConfig()

    // Get required contract addresses
    const accessControlAddress = config.contractAddresses['ZothAccessControl']
    const zOPALAddress = config.contractAddresses['zOPAL']
    const depositVaultAddress = config.contractAddresses['zOPALDepositVault']

    if (!accessControlAddress || !zOPALAddress || !depositVaultAddress) {
        throw new Error(
            'Required contracts not deployed:\n' +
            `  - ZothAccessControl: ${accessControlAddress || 'MISSING'}\n` +
            `  - zOPAL: ${zOPALAddress || 'MISSING'}\n` +
            `  - zOPALDepositVault: ${depositVaultAddress || 'MISSING'}`
        )
    }

    Logger.log('ZothAccessControl', accessControlAddress, 1)
    Logger.log('zOPAL', zOPALAddress, 1)
    Logger.log('zOPALDepositVault', depositVaultAddress, 1)

    // Configuration parameters
    const [deployer] = await ethers.getSigners()

    // USDC addresses per network
    const USDC_ADDRESSES: Record<string, string> = {
        'base': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        'ethereum': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        'polygon': '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
        'hardhat': ethers.ZeroAddress, // Will be mocked in tests
        'localhost': ethers.ZeroAddress,
    }

    const usdcAddress = config.usdcAddress || USDC_ADDRESSES[network.name] || ethers.ZeroAddress

    // For hardhat/localhost, deploy mock USDC if not configured
    let finalUsdcAddress = usdcAddress
    if (finalUsdcAddress === ethers.ZeroAddress) {
        Logger.log('Deploying Mock USDC for testing...', '', 1)
        const MockTokenFactory = await ethers.getContractFactory('MockERC20')
        const mockUSDC = await MockTokenFactory.deploy('USD Coin', 'USDC', 6)
        await mockUSDC.waitForDeployment()
        finalUsdcAddress = await mockUSDC.getAddress()
        Logger.success('Mock USDC deployed', finalUsdcAddress, 1)
    }

    // MPC wallet address (required - should come from config for mainnet)
    const mpcWalletAddress = config.stakingVault?.mpcWalletAddress || config.tokensReceiver || deployer.address

    // Fee receiver address
    const feeReceiverAddress = config.stakingVault?.feeReceiver || config.feeReceiver || deployer.address

    // Sanctions list (optional)
    const sanctionsListAddress = config.sanctionsList || ethers.ZeroAddress

    Logger.log('Configuration:', undefined, 1)
    Logger.log('  USDC', finalUsdcAddress, 1)
    Logger.log('  MPC Wallet', mpcWalletAddress, 1)
    Logger.log('  Fee Receiver', feeReceiverAddress, 1)
    Logger.log('  Sanctions List', sanctionsListAddress || 'disabled', 1)

    // Get the contract factory
    const zOPALStakingVaultFactory = await ethers.getContractFactory('zOPALStakingVault')

    // Prepare initialization parameters
    const initParams = [
        accessControlAddress,      // _accessControl
        finalUsdcAddress,          // _usdc
        zOPALAddress,              // _zOPAL
        depositVaultAddress,       // _depositVault
        mpcWalletAddress,          // _mpcWalletAddress
        feeReceiverAddress,        // _feeReceiver
        sanctionsListAddress,      // _sanctionsList
    ]

    // Encode initializer
    const initData = zOPALStakingVaultFactory.interface.encodeFunctionData(
        'initialize',
        initParams
    )

    // Deploy the contract
    const [implementationAddress, proxyAddress] = await deploymentManager.deployContract(
        'zOPALStakingVault',
        zOPALStakingVaultFactory,
        [],
        initData
    )

    // Role setup
    const ZothAccessControl = await ethers.getContractAt('ZothAccessControl', accessControlAddress)
    const STAKING_VAULT_ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes('STAKING_VAULT_ADMIN_ROLE'))
    const STAKING_VAULT_PAUSE_OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes('STAKING_VAULT_PAUSE_OPERATOR_ROLE'))
    const GREENLISTED_ROLE = await ZothAccessControl.GREENLISTED_ROLE()

    // Grant admin role to deployer (for initial setup)
    const deployerHasAdminRole = await ZothAccessControl.hasRole(STAKING_VAULT_ADMIN_ROLE, deployer.address)
    if (!deployerHasAdminRole) {
        const tx = await ZothAccessControl.grantRole(STAKING_VAULT_ADMIN_ROLE, deployer.address)
        await tx.wait()
        Logger.success('STAKING_VAULT_ADMIN_ROLE granted to deployer', undefined, 1)
    } else {
        Logger.info('Deployer already has STAKING_VAULT_ADMIN_ROLE', undefined, 1)
    }

    // Grant pause operator role to deployer
    const deployerHasPauseRole = await ZothAccessControl.hasRole(STAKING_VAULT_PAUSE_OPERATOR_ROLE, deployer.address)
    if (!deployerHasPauseRole) {
        const tx = await ZothAccessControl.grantRole(STAKING_VAULT_PAUSE_OPERATOR_ROLE, deployer.address)
        await tx.wait()
        Logger.success('STAKING_VAULT_PAUSE_OPERATOR_ROLE granted to deployer', undefined, 1)
    } else {
        Logger.info('Deployer already has STAKING_VAULT_PAUSE_OPERATOR_ROLE', undefined, 1)
    }

    // Greenlist the staking vault so it can interact with deposit vault
    const vaultIsGreenlisted = await ZothAccessControl.hasRole(GREENLISTED_ROLE, proxyAddress)
    if (!vaultIsGreenlisted) {
        const tx = await ZothAccessControl.grantRole(GREENLISTED_ROLE, proxyAddress)
        await tx.wait()
        Logger.success('Staking Vault greenlisted for deposit vault interactions', undefined, 1)
    } else {
        Logger.info('Staking Vault already greenlisted', undefined, 1)
    }

    // Verify deployment
    const stakingVault = await ethers.getContractAt('zOPALStakingVault', proxyAddress)
    const vaultAccessControl = await stakingVault.accessControl()
    const vaultUsdc = await stakingVault.usdc()
    const vaultZOPAL = await stakingVault.zOPAL()
    const vaultDepositVault = await stakingVault.depositVault()
    const vaultMpcWallet = await stakingVault.mpcWalletAddress()
    const vaultFeeReceiver = await stakingVault.feeReceiver()
    const vaultLockDuration = await stakingVault.lockDuration()
    const vaultEarlyWithdrawalFee = await stakingVault.earlyWithdrawalFee()
    const vaultMinDeposit = await stakingVault.minDepositAmount()

    Logger.log('Verification:', '', 1)
    Logger.log('Access Control matches', (vaultAccessControl.toLowerCase() === accessControlAddress.toLowerCase()).toString(), 2)
    Logger.log('USDC matches', (vaultUsdc.toLowerCase() === finalUsdcAddress.toLowerCase()).toString(), 2)
    Logger.log('zOPAL matches', (vaultZOPAL.toLowerCase() === zOPALAddress.toLowerCase()).toString(), 2)
    Logger.log('Deposit Vault matches', (vaultDepositVault.toLowerCase() === depositVaultAddress.toLowerCase()).toString(), 2)
    Logger.log('MPC Wallet', vaultMpcWallet, 2)
    Logger.log('Fee Receiver', vaultFeeReceiver, 2)
    Logger.log('Lock Duration', `${Number(vaultLockDuration) / 86400} days`, 2)
    Logger.log('Early Withdrawal Fee', `${Number(vaultEarlyWithdrawalFee) / 100}%`, 2)
    Logger.log('Min Deposit', `${ethers.formatUnits(vaultMinDeposit, 6)} USDC`, 2)

    // Verify the contract on live networks
    await deploymentManager.verifyContract(
        'zOPALStakingVault',
        [implementationAddress, proxyAddress],
        [],
        initData
    )
    await deploymentManager.verifyOnTenderly('zOPALStakingVault', [implementationAddress, proxyAddress])

    Logger.deploymentSuccess('zOPALStakingVault', proxyAddress)

    Logger.section('Next Steps')
    Logger.log('1. Configure MPC wallet if not using deployer address')
    Logger.log('2. Configure fee receiver if not using deployer address')
    Logger.log('3. Grant STAKING_VAULT_ADMIN_ROLE to multisig')
    Logger.log('4. Grant STAKING_VAULT_PAUSE_OPERATOR_ROLE to operators')
    Logger.log('5. Greenlist users who should be able to deposit')
    Logger.log('6. Revoke deployer roles for production')

    return true
}

export default func
func.tags = ['zOPALStakingVault']
func.id = 'deploy_zopal_staking_vault'
func.dependencies = ['ZothAccessControl', 'zOPAL', 'zOPALDepositVault']
