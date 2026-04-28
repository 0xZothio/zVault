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

    // Get the contract factory
    const ZothAccessControl = await ethers.getContractFactory('ZothAccessControl')

    // Encode initializer
    const initData = ZothAccessControl.interface.encodeFunctionData(
        'initialize',
        []
    )

    // Deploy the contract
    const [implementationAddress, proxyAddress] = await deploymentManager.deployContract(
        'ZothAccessControl',
        ZothAccessControl,
        [],
        initData
    )

    // Verify deployment
    const accessControl = await ethers.getContractAt('ZothAccessControl', proxyAddress)
    const [deployer] = await ethers.getSigners()

    const DEFAULT_ADMIN_ROLE = ethers.ZeroHash

    // Check deployer roles (granted by initialize)
    const hasAdminRole = await accessControl.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)
    Logger.log('Deployer has DEFAULT_ADMIN_ROLE', hasAdminRole.toString(), 1)

    // Verify the contract on live networks
    await deploymentManager.verifyContract(
        'ZothAccessControl',
        [implementationAddress, proxyAddress],
        [],
        initData
    )
    await deploymentManager.verifyOnTenderly('ZothAccessControl', [implementationAddress, proxyAddress])

    Logger.deploymentSuccess('ZothAccessControl', proxyAddress)

    return true
}

export default func
func.tags = ['ZothAccessControl']
func.id = 'deploy_zoth_access_control'
