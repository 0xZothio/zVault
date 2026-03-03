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
    const zOPALDepositVault = await ethers.getContractFactory('zOPALDepositVault')

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
    const initData = zOPALDepositVault.interface.encodeFunctionData(
        'initialize',
        initParams
    )

    // Deploy the contract
    const [implementationAddress, proxyAddress] = await deploymentManager.deployContract(
        'zOPALDepositVault',
        zOPALDepositVault,
        [],
        initData
    )

    // Grant mint role to vault (essential for vault to function)
    const ZothAccessControl = await ethers.getContractAt('ZothAccessControl', accessControlAddress)
    const ZOPAL_MINT_OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ZOPAL_MINT_OPERATOR_ROLE'))

    const vaultHasMintRole = await ZothAccessControl.hasRole(ZOPAL_MINT_OPERATOR_ROLE, proxyAddress)
    if (!vaultHasMintRole) {
        const tx = await ZothAccessControl.grantRole(ZOPAL_MINT_OPERATOR_ROLE, proxyAddress)
        await tx.wait()
        Logger.success('MINT_OPERATOR_ROLE granted to vault', undefined, 1)
    } else {
        Logger.info('Vault already has MINT_OPERATOR_ROLE', undefined, 1)
    }

    // Verify deployment
    const vault = await ethers.getContractAt('zOPALDepositVault', proxyAddress)
    const vaultAccessControl = await vault.accessControl()
    const vaultZToken = await vault.zToken()
    const vaultMinAmount = await vault.minAmount()
    const vaultMaxSupplyCap = await vault.maxSupplyCap()

    Logger.log('Verification:', '', 1)
    Logger.log('Access Control matches', (vaultAccessControl.toLowerCase() === accessControlAddress.toLowerCase()).toString(), 2)
    Logger.log('zToken matches', (vaultZToken.toLowerCase() === zOPALAddress.toLowerCase()).toString(), 2)
    Logger.log('Min Amount', ethers.formatEther(vaultMinAmount), 2)
    Logger.log('Max Supply Cap', ethers.formatEther(vaultMaxSupplyCap), 2)

    // Verify the contract on live networks
    await deploymentManager.verifyContract(
        'zOPALDepositVault',
        [implementationAddress, proxyAddress],
        [],
        initData
    )
    await deploymentManager.verifyOnTenderly('zOPALDepositVault', [implementationAddress, proxyAddress])

    Logger.deploymentSuccess('zOPALDepositVault', proxyAddress)

    return true
}

export default func
func.tags = ['zOPALDepositVault']
func.id = 'deploy_zopal_deposit_vault'
func.dependencies = ['ZothAccessControl', 'zOPAL', 'PriceOracle']
