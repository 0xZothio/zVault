import { ethers } from 'hardhat'
import { DeployFunction } from 'hardhat-deploy/types'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeploymentManager } from '../deployment-manager/DeploymentManager'
import { Logger } from '../utils/logger'
import { requireAccessControl, ensureSharedProxyAdmin } from './lib/mag7'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { network } = hre

    const deploymentManager = new DeploymentManager(network.name, hre)
    await deploymentManager.initialize()
    const config = await deploymentManager.getConfig()

    const accessControlAddress = requireAccessControl(config)
    Logger.log('Reusing ZothAccessControl', accessControlAddress, 1)

    const proxyAdminAddress = await ensureSharedProxyAdmin(deploymentManager, config, network.name)
    Logger.log('Shared ProxyAdmin', proxyAdminAddress, 1)

    const sanctionsListAddress = config.sanctionsList || ethers.ZeroAddress
    Logger.log(
        'Using SanctionsList',
        sanctionsListAddress === ethers.ZeroAddress ? 'Disabled' : sanctionsListAddress,
        1
    )

    const zMAG7 = await ethers.getContractFactory('zMAG7')
    const initData = zMAG7.interface.encodeFunctionData('initialize', [
        accessControlAddress,
        sanctionsListAddress,
    ])

    const [implementationAddress, proxyAddress] = await deploymentManager.deployContract(
        'zMAG7',
        zMAG7,
        [accessControlAddress, sanctionsListAddress],
        initData
    )

    const token = await ethers.getContractAt('zMAG7', proxyAddress)
    Logger.log('Token Name', await token.name(), 1)
    Logger.log('Token Symbol', await token.symbol(), 1)
    Logger.log('Total Supply', ethers.formatEther(await token.totalSupply()), 1)
    Logger.log(
        'Access Control matches',
        ((await token.accessControl()).toLowerCase() === accessControlAddress.toLowerCase()).toString(),
        1
    )

    await deploymentManager.verifyContract(
        'zMAG7',
        [implementationAddress, proxyAddress],
        [accessControlAddress, sanctionsListAddress],
        initData
    )
    await deploymentManager.verifyOnTenderly('zMAG7', [implementationAddress, proxyAddress])

    Logger.deploymentSuccess('zMAG7 Token', proxyAddress)
    return true
}

export default func
func.tags = ['zMAG7', 'MAG7']
func.id = 'deploy_zmag7_token'
func.dependencies = ['ZothAccessControl', 'MAG7Confirm']
