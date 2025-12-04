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
    const accessControlAddress = config.contractAddresses['MidasAccessControl']
    const zHyperAddress = config.contractAddresses['zHYPER']
    const dataFeedAddress = config.contractAddresses['PriceOracle']

    if (!accessControlAddress || !zHyperAddress || !dataFeedAddress) {
        throw new Error(
            'Required contracts not deployed:\n' +
            `  - MidasAccessControl: ${accessControlAddress || 'MISSING'}\n` +
            `  - zHYPER: ${zHyperAddress || 'MISSING'}\n` +
            `  - PriceOracle: ${dataFeedAddress || 'MISSING'}`
        )
    }

    Logger.log('MidasAccessControl', accessControlAddress, 1)
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
    const ZHyperDepositVault = await ethers.getContractFactory('ZHyperDepositVault')

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
    const initData = ZHyperDepositVault.interface.encodeFunctionData(
        'initialize',
        initParams
    )

    // Deploy the contract
    const [implementationAddress, proxyAddress] = await deploymentManager.deployContract(
        'ZHyperDepositVault',
        ZHyperDepositVault,
        [],
        initData
    )

    // Grant necessary roles
    Logger.log('Setting up roles...', undefined, 1)
    const MidasAccessControl = await ethers.getContractAt(
        'MidasAccessControl',
        accessControlAddress
    )

    const Z_HYPER_DEPOSIT_VAULT_ADMIN_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes('Z_HYPER_DEPOSIT_VAULT_ADMIN_ROLE')
    )
    const Z_HYPER_MINT_OPERATOR_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes('Z_HYPER_MINT_OPERATOR_ROLE')
    )

    // Grant vault admin role to deployer
    let tx = await MidasAccessControl.grantRole(
        Z_HYPER_DEPOSIT_VAULT_ADMIN_ROLE,
        deployer.address
    )
    await tx.wait()
    Logger.success('Vault admin role granted to deployer', undefined, 2)

    // Grant mint role to vault
    tx = await MidasAccessControl.grantRole(
        Z_HYPER_MINT_OPERATOR_ROLE,
        proxyAddress
    )
    await tx.wait()
    Logger.success('Mint role granted to vault', undefined, 2)

    // Verify deployment
    const vault = ZHyperDepositVault.attach(proxyAddress)
    const vaultAccessControl = await vault.accessControl()
    const vaultMToken = await vault.zToken()
    const vaultMinAmount = await vault.minAmount()
    const vaultMaxSupplyCap = await vault.maxSupplyCap()

    Logger.log('Verification:', '', 1)
    Logger.log('Access Control matches', (vaultAccessControl.toLowerCase() === accessControlAddress.toLowerCase()).toString(), 2)
    Logger.log('zToken matches', (vaultMToken.toLowerCase() === zHyperAddress.toLowerCase()).toString(), 2)
    Logger.log('Min Amount', ethers.formatEther(vaultMinAmount), 2)
    Logger.log('Max Supply Cap', ethers.formatEther(vaultMaxSupplyCap), 2)

    // Verify the contract on live networks
    await deploymentManager.verifyContract(
        'ZHyperDepositVault',
        [implementationAddress, proxyAddress],
        [],
        initData
    )
    await deploymentManager.verifyOnTenderly('ZHyperDepositVault', [implementationAddress, proxyAddress])

    Logger.deploymentSuccess('ZHyperDepositVault', proxyAddress)

    return true
}

export default func
func.tags = ['ZHyperDepositVault']
func.id = 'deploy_mhyper_deposit_vault'
func.dependencies = ['MidasAccessControl', 'zHYPER', 'PriceOracle']
