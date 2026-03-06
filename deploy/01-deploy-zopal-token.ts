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

    // Get ZothAccessControl address
    const accessControlAddress = config.contractAddresses['ZothAccessControl']
    if (!accessControlAddress) {
        throw new Error('ZothAccessControl not deployed. Please deploy it first.')
    }

    Logger.log('Using ZothAccessControl', accessControlAddress, 1)

    // Get sanctions list address (use zero address to disable)
    const sanctionsListAddress = config.sanctionsList || ethers.ZeroAddress
    Logger.log('Using SanctionsList', sanctionsListAddress === ethers.ZeroAddress ? 'Disabled' : sanctionsListAddress, 1)

    // Get the contract factory
    const zOPAL = await ethers.getContractFactory('zOPAL')

    // Encode initializer with both accessControl and sanctionsList
    const initData = zOPAL.interface.encodeFunctionData(
        'initialize',
        [accessControlAddress, sanctionsListAddress]
    )

    // Deploy the contract
    const [implementationAddress, proxyAddress] = await deploymentManager.deployContract(
        'zOPAL',
        zOPAL,
        [accessControlAddress, sanctionsListAddress],
        initData
    )

    // Verify deployment
    const zopal = await ethers.getContractAt('zOPAL', proxyAddress)
    const name = await zopal.name()
    const symbol = await zopal.symbol()
    const totalSupply = await zopal.totalSupply()
    const accessControl = await zopal.accessControl()
    const sanctionsList = await zopal.sanctionsList()

    Logger.log('Token Name', name, 1)
    Logger.log('Token Symbol', symbol, 1)
    Logger.log('Total Supply', ethers.formatEther(totalSupply), 1)
    Logger.log('Access Control matches', (accessControl.toLowerCase() === accessControlAddress.toLowerCase()).toString(), 1)
    Logger.log('Sanctions List', sanctionsList === ethers.ZeroAddress ? 'Disabled' : sanctionsList, 1)

    // Verify the contract on live networks
    await deploymentManager.verifyContract(
        'zOPAL',
        [implementationAddress, proxyAddress],
        [accessControlAddress],
        initData
    )
    await deploymentManager.verifyOnTenderly('zOPAL', [implementationAddress, proxyAddress])

    Logger.deploymentSuccess('zOPAL Token', proxyAddress)

    return true
}

export default func
func.tags = ['zOPAL']
func.id = 'deploy_zopal_token'
func.dependencies = ['ZothAccessControl']
