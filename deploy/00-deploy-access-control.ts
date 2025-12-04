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

    // Get the contract factory
    const MidasAccessControl = await ethers.getContractFactory('MidasAccessControl')

    // Encode initializer
    const initData = MidasAccessControl.interface.encodeFunctionData(
        'initialize',
        []
    )

    // Deploy the contract
    const [implementationAddress, proxyAddress] = await deploymentManager.deployContract(
        'MidasAccessControl',
        MidasAccessControl,
        [],
        initData
    )

    // Verify deployment
    const accessControl = MidasAccessControl.attach(proxyAddress)
    const [deployer] = await ethers.getSigners()

    const DEFAULT_ADMIN_ROLE = ethers.ZeroHash
    const hasAdminRole = await accessControl.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)
    Logger.log('Deployer has DEFAULT_ADMIN_ROLE', hasAdminRole.toString(), 1)

    const DEPOSIT_VAULT_ADMIN_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes('DEPOSIT_VAULT_ADMIN_ROLE')
    )
    const hasDepositAdmin = await accessControl.hasRole(
        DEPOSIT_VAULT_ADMIN_ROLE,
        deployer.address
    )
    Logger.log('Deployer has DEPOSIT_VAULT_ADMIN_ROLE', hasDepositAdmin.toString(), 1)

    // Verify the contract on live networks
    await deploymentManager.verifyContract(
        'MidasAccessControl',
        [implementationAddress, proxyAddress],
        [],
        initData
    )
    await deploymentManager.verifyOnTenderly('MidasAccessControl', [implementationAddress, proxyAddress])

    Logger.deploymentSuccess('MidasAccessControl', proxyAddress)

    return true
}

export default func
func.tags = ['MidasAccessControl']
func.id = 'deploy_midas_access_control'
