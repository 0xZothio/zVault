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

    // Get the contract factory
    const ZHyper = await ethers.getContractFactory('zHYPER')

    // Encode initializer
    const initData = ZHyper.interface.encodeFunctionData(
        'initialize',
        [accessControlAddress]
    )

    // Deploy the contract
    const [implementationAddress, proxyAddress] = await deploymentManager.deployContract(
        'zHYPER',
        ZHyper,
        [accessControlAddress],
        initData
    )

    // Verify deployment
    const zHyper = ZHyper.attach(proxyAddress)
    const name = await zHyper.name()
    const symbol = await zHyper.symbol()
    const totalSupply = await zHyper.totalSupply()
    const accessControl = await zHyper.accessControl()

    Logger.log('Token Name', name, 1)
    Logger.log('Token Symbol', symbol, 1)
    Logger.log('Total Supply', ethers.formatEther(totalSupply), 1)
    Logger.log('Access Control matches', (accessControl.toLowerCase() === accessControlAddress.toLowerCase()).toString(), 1)

    // Grant necessary roles
    Logger.log('Setting up roles...', undefined, 1)
    const ZothAccessControl = await ethers.getContractAt(
        'ZothAccessControl',
        accessControlAddress
    )
    const [deployer] = await ethers.getSigners()

    const Z_HYPER_MINT_OPERATOR_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes('Z_HYPER_MINT_OPERATOR_ROLE')
    )
    const Z_HYPER_BURN_OPERATOR_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes('Z_HYPER_BURN_OPERATOR_ROLE')
    )
    const Z_HYPER_PAUSE_OPERATOR_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes('Z_HYPER_PAUSE_OPERATOR_ROLE')
    )

    // Grant mint role
    let tx = await ZothAccessControl.grantRole(
        Z_HYPER_MINT_OPERATOR_ROLE,
        deployer.address
    )
    await tx.wait()
    Logger.success('Mint role granted to deployer', undefined, 2)

    // Grant burn role
    tx = await ZothAccessControl.grantRole(
        Z_HYPER_BURN_OPERATOR_ROLE,
        deployer.address
    )
    await tx.wait()
    Logger.success('Burn role granted to deployer', undefined, 2)

    // Grant pause role
    tx = await ZothAccessControl.grantRole(
        Z_HYPER_PAUSE_OPERATOR_ROLE,
        deployer.address
    )
    await tx.wait()
    Logger.success('Pause role granted to deployer', undefined, 2)

    // Test minting
    Logger.log('Testing token mint...', undefined, 1)
    const testAmount = ethers.parseEther('100')
    tx = await zHyper.mint(deployer.address, testAmount)
    await tx.wait()
    const balance = await zHyper.balanceOf(deployer.address)
    Logger.success('Test mint successful. Balance', ethers.formatEther(balance), 2)

    // Verify the contract on live networks
    await deploymentManager.verifyContract(
        'zHYPER',
        [implementationAddress, proxyAddress],
        [accessControlAddress],
        initData
    )
    await deploymentManager.verifyOnTenderly('zHYPER', [implementationAddress, proxyAddress])

    Logger.deploymentSuccess('zHYPER Token', proxyAddress)

    return true
}

export default func
func.tags = ['zHYPER']
func.id = 'deploy_zhyper_token'
func.dependencies = ['ZothAccessControl']
