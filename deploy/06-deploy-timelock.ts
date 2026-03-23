import { ethers } from 'hardhat'
import { DeployFunction } from 'hardhat-deploy/types'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeploymentManager } from '../deployment-manager/DeploymentManager'
import { Logger, Spinner } from '../utils/logger'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { network } = hre

    Logger.banner('UPGRADE TIMELOCK DEPLOYMENT')

    // Initialize deployment manager to get config
    const deploymentManager = new DeploymentManager(network.name, hre);
    await deploymentManager.initialize();
    const config = await deploymentManager.getConfig()

    const [deployer] = await ethers.getSigners()
    const roles = config.roles || {}
    const timelockConfig = config.timelock || {}

    Logger.log('Deployer', deployer.address)
    Logger.log('Network', network.name)

    // Check if timelock is enabled
    if (!timelockConfig.enabled) {
        Logger.warning('Timelock not enabled for this network')
        Logger.info('Set timelock.enabled = true in deployment.json to enable')
        return true
    }

    // Check ProxyAdmin exists
    const proxyAdminAddress = config.contractAddresses['ProxyAdmin']
    if (!proxyAdminAddress) {
        throw new Error('ProxyAdmin not found. Deploy contracts first with --tags Complete')
    }

    // Check defaultAdmin is configured
    if (!roles.defaultAdmin) {
        throw new Error('defaultAdmin not configured in deployment.json')
    }

    const proxyAdmin = await ethers.getContractAt('ProxyAdmin', proxyAdminAddress)
    const currentOwner = await proxyAdmin.owner()

    Logger.log('ProxyAdmin', proxyAdminAddress)
    Logger.log('Current Owner', currentOwner)
    Logger.log('Target Admin', roles.defaultAdmin)

    // Check if already transferred to a timelock
    const existingTimelockAddress = config.contractAddresses['UpgradeTimelock']
    if (existingTimelockAddress) {
        if (currentOwner.toLowerCase() === existingTimelockAddress.toLowerCase()) {
            Logger.info('ProxyAdmin already owned by UpgradeTimelock')
            Logger.log('UpgradeTimelock', existingTimelockAddress)
            return true
        }
    }

    // ========== Deploy UpgradeTimelock ==========
    Logger.section('Deploying Upgrade Timelock')
    
    const minDelay = timelockConfig.minDelay || 86400 // Default 24 hours
    Logger.log('Min Delay', (minDelay / 3600) + ' hours')
    Logger.log('Proposers', roles.defaultAdmin)
    Logger.log('Executors', roles.defaultAdmin)
    Logger.log('Admin', roles.defaultAdmin)

    const UpgradeTimelock = await ethers.getContractFactory('UpgradeTimelock')
    Spinner.start('Deploying UpgradeTimelock...')
    const timelock = await UpgradeTimelock.deploy(
        minDelay,
        [roles.defaultAdmin], // proposers
        [roles.defaultAdmin], // executors
        roles.defaultAdmin    // admin (can manage roles)
    )
    await timelock.waitForDeployment()
    const timelockAddress = await timelock.getAddress()
    Spinner.stop(true, `UpgradeTimelock deployed: ${timelockAddress}`)

    // Save timelock address
    await hre.deployments.save('UpgradeTimelock', {
        abi: JSON.parse(UpgradeTimelock.interface.formatJson()),
        address: timelockAddress,
        args: [minDelay, [roles.defaultAdmin], [roles.defaultAdmin], roles.defaultAdmin]
    })

    // Verify on block explorer
    if (network.name !== 'hardhat' && network.name !== 'localhost') {
        try {
            Logger.log('Verifying on Etherscan...', undefined, 1)
            await hre.run('verify:verify', {
                address: timelockAddress,
                constructorArguments: [minDelay, [roles.defaultAdmin], [roles.defaultAdmin], roles.defaultAdmin]
            })
            Logger.success('UpgradeTimelock verified', undefined, 1)
        } catch (error: any) {
            if (error.message.includes('Already Verified') || error.message.includes('already verified')) {
                Logger.info('UpgradeTimelock already verified', undefined, 1)
            } else {
                Logger.warning('Verification failed', 'Verify manually later', 1)
            }
        }
    }

    // ========== Transfer ProxyAdmin to Timelock ==========
    Logger.section('Transferring ProxyAdmin to Timelock')

    if (currentOwner.toLowerCase() !== deployer.address.toLowerCase()) {
        Logger.warning('ProxyAdmin not owned by deployer')
        Logger.info(`Current owner: ${currentOwner}`)
        Logger.info('Manual transfer required by current owner')
        return true
    }

    Spinner.start(`Transferring ProxyAdmin to ${timelockAddress}...`)
    const tx = await proxyAdmin.transferOwnership(timelockAddress)
    await tx.wait()
    Spinner.stop(true, 'ProxyAdmin ownership transferred to UpgradeTimelock')

    // Verify transfer
    const newOwner = await proxyAdmin.owner()
    if (newOwner.toLowerCase() === timelockAddress.toLowerCase()) {
        Logger.success('Transfer verified')
    } else {
        Logger.error('Transfer verification failed!')
    }

    // ========== Summary ==========
    Logger.banner('TIMELOCK DEPLOYMENT COMPLETE')

    Logger.section('Deployed Contracts')
    Logger.log('UpgradeTimelock', timelockAddress)
    Logger.log('ProxyAdmin Owner', timelockAddress)

    Logger.section('Upgrade Process')
    Logger.log('1. Proposer schedules upgrade via timelock.schedule()')
    Logger.log(`2. Wait ${minDelay / 3600} hours (min delay)`)
    Logger.log('3. Executor calls timelock.execute() to perform upgrade')

    Logger.section('Timelock Roles')
    Logger.log('PROPOSER_ROLE', roles.defaultAdmin)
    Logger.log('EXECUTOR_ROLE', roles.defaultAdmin)
    Logger.log('TIMELOCK_ADMIN_ROLE', roles.defaultAdmin)

    return true
}

export default func
func.tags = ['UpgradeTimelock']
func.id = 'deploy_timelock'
