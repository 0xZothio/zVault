import { ethers } from 'hardhat'
import { DeployFunction } from 'hardhat-deploy/types'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeploymentManager } from '../deployment-manager/DeploymentManager'
import { ConfigService } from '../services/ConfigService'
import { Logger, Spinner } from '../utils/logger'

/**
 * Timelock Role Configuration
 * 
 * PROPOSER: Can schedule upgrade operations (Nav Change operator)
 * EXECUTOR: Can execute operations after delay (Super Admin)
 * CANCELLER: Can cancel scheduled operations (Super Admin) - requires post-deploy adjustment
 * ADMIN: Can grant/revoke roles on the timelock itself (Super Admin)
 * 
 * NOTE: OpenZeppelin's TimelockController auto-grants CANCELLER_ROLE to proposers.
 *       After deployment, Super Admin must:
 *       1. Grant CANCELLER_ROLE to itself
 *       2. Revoke CANCELLER_ROLE from the proposer
 */
const TIMELOCK_ROLES = {
    // Proposer - can schedule upgrades (Nav Change)
    proposer: '0x15925A7571f5bD7CE67EeeddFAA31136E565683e',
    
    // Executor & Canceller - can execute/cancel (Super Admin)
    executor: '0x973Bd2510d866b1F2494c97ca9fd9595037B2F04',
    
    // Admin - can manage timelock roles (Super Admin)
    admin: '0x973Bd2510d866b1F2494c97ca9fd9595037B2F04'
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { network } = hre

    Logger.banner('UPGRADE TIMELOCK DEPLOYMENT')

    // Initialize deployment manager to get config
    const deploymentManager = new DeploymentManager(network.name, hre);
    await deploymentManager.initialize();
    const config = await deploymentManager.getConfig()

    const [deployer] = await ethers.getSigners()
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

    // Check if timelock already deployed
    const existingTimelockAddress = config.contractAddresses['UpgradeTimelock']
    if (existingTimelockAddress) {
        Logger.info('UpgradeTimelock already deployed')
        Logger.log('UpgradeTimelock', existingTimelockAddress)
        return true
    }

    Logger.log('ProxyAdmin', proxyAdminAddress)

    // ========== Deploy UpgradeTimelock ==========
    Logger.section('Deploying Upgrade Timelock')
    
    const minDelay = timelockConfig.minDelay || 86400 // Default 24 hours
    
    Logger.log('Min Delay', (minDelay / 3600) + ' hours')
    Logger.log('Proposer (Nav Change)', TIMELOCK_ROLES.proposer)
    Logger.log('Executor (Super Admin)', TIMELOCK_ROLES.executor)
    Logger.log('Admin (Super Admin)', TIMELOCK_ROLES.admin)

    const UpgradeTimelock = await ethers.getContractFactory('UpgradeTimelock')
    Spinner.start('Deploying UpgradeTimelock...')
    const timelock = await UpgradeTimelock.deploy(
        minDelay,
        [TIMELOCK_ROLES.proposer],  // proposers - Nav Change
        [TIMELOCK_ROLES.executor],  // executors - Super Admin
        TIMELOCK_ROLES.admin        // admin - Super Admin (can manage roles)
    )
    await timelock.waitForDeployment()
    const timelockAddress = await timelock.getAddress()
    Spinner.stop(true, `UpgradeTimelock deployed: ${timelockAddress}`)

    // Save timelock address to hardhat-deploy
    await hre.deployments.save('UpgradeTimelock', {
        abi: JSON.parse(UpgradeTimelock.interface.formatJson()),
        address: timelockAddress,
        args: [minDelay, [TIMELOCK_ROLES.proposer], [TIMELOCK_ROLES.executor], TIMELOCK_ROLES.admin]
    })

    // Save to config/deployed/<network>.json
    const configService = ConfigService.getInstance()
    await configService.updateAddress(network.name, 'UpgradeTimelock', timelockAddress)
    Logger.success('Saved UpgradeTimelock to config')

    // Verify on block explorer
    if (network.name !== 'hardhat' && network.name !== 'localhost') {
        try {
            Logger.log('Verifying on block explorer...', undefined, 1)
            await hre.run('verify:verify', {
                address: timelockAddress,
                constructorArguments: [
                    minDelay, 
                    [TIMELOCK_ROLES.proposer], 
                    [TIMELOCK_ROLES.executor], 
                    TIMELOCK_ROLES.admin
                ]
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

    // ========== Summary ==========
    Logger.banner('TIMELOCK DEPLOYMENT COMPLETE')

    Logger.section('Deployed Contract')
    Logger.log('UpgradeTimelock', timelockAddress)

    Logger.section('Current Timelock Roles (after deployment)')
    Logger.log('PROPOSER_ROLE', TIMELOCK_ROLES.proposer + ' (Nav Change)')
    Logger.log('EXECUTOR_ROLE', TIMELOCK_ROLES.executor + ' (Super Admin)')
    Logger.log('CANCELLER_ROLE', TIMELOCK_ROLES.proposer + ' (auto-granted to proposer)')
    Logger.log('TIMELOCK_ADMIN_ROLE', TIMELOCK_ROLES.admin + ' (Super Admin)')

    // Generate role adjustment calldata
    const CANCELLER_ROLE = await timelock.CANCELLER_ROLE()
    
    const grantCancellerCalldata = timelock.interface.encodeFunctionData('grantRole', [
        CANCELLER_ROLE,
        TIMELOCK_ROLES.executor  // Grant to Super Admin
    ])
    
    const revokeCancellerCalldata = timelock.interface.encodeFunctionData('revokeRole', [
        CANCELLER_ROLE,
        TIMELOCK_ROLES.proposer  // Revoke from Nav Change
    ])

    Logger.section('REQUIRED: Fix CANCELLER_ROLE Assignment')
    Logger.warning('CANCELLER_ROLE was auto-granted to Proposer by OpenZeppelin')
    Logger.info('Super Admin must fix this by granting to itself and revoking from Proposer')

    console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║  STEP 1: ADJUST CANCELLER_ROLE (Super Admin must do this)         ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  Transaction 1: Grant CANCELLER_ROLE to Super Admin               ║
║  ─────────────────────────────────────────────────────────────────║
║  TO:    ${timelockAddress}
║  VALUE: 0                                                         ║
║  DATA:  ${grantCancellerCalldata}
║                                                                   ║
║  Transaction 2: Revoke CANCELLER_ROLE from Nav Change             ║
║  ─────────────────────────────────────────────────────────────────║
║  TO:    ${timelockAddress}
║  VALUE: 0                                                         ║
║  DATA:  ${revokeCancellerCalldata}
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
    `)

    // Safe batch transaction JSON
    const safeBatchTx = [
        {
            to: timelockAddress,
            value: "0",
            data: grantCancellerCalldata,
            operation: 0
        },
        {
            to: timelockAddress,
            value: "0",
            data: revokeCancellerCalldata,
            operation: 0
        }
    ]

    console.log('Safe Batch Transaction JSON (for Transaction Builder):')
    console.log(JSON.stringify(safeBatchTx, null, 2))

    // Next steps for ProxyAdmin transfer
    const proxyAdmin = await ethers.getContractAt('ProxyAdmin', proxyAdminAddress)
    const currentOwner = await proxyAdmin.owner()

    const transferOwnershipCalldata = proxyAdmin.interface.encodeFunctionData('transferOwnership', [
        timelockAddress
    ])

    console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║  STEP 2: TRANSFER PROXYADMIN OWNERSHIP (Current owner must do)    ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  ProxyAdmin: ${proxyAdminAddress}
║  Current Owner: ${currentOwner}
║  New Owner: ${timelockAddress}
║                                                                   ║
║  Transaction:                                                     ║
║  ─────────────────────────────────────────────────────────────────║
║  TO:    ${proxyAdminAddress}
║  VALUE: 0                                                         ║
║  DATA:  ${transferOwnershipCalldata}
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
    `)

    Logger.section('Final Role Configuration (after adjustments)')
    Logger.log('PROPOSER_ROLE', TIMELOCK_ROLES.proposer + ' (Nav Change)')
    Logger.log('EXECUTOR_ROLE', TIMELOCK_ROLES.executor + ' (Super Admin)')
    Logger.log('CANCELLER_ROLE', TIMELOCK_ROLES.executor + ' (Super Admin)')
    Logger.log('TIMELOCK_ADMIN_ROLE', TIMELOCK_ROLES.admin + ' (Super Admin)')

    Logger.section('Upgrade Process')
    Logger.log('1. Proposer (Nav Change) schedules upgrade via timelock.schedule()')
    Logger.log(`2. Wait ${minDelay / 3600} hours (min delay)`)
    Logger.log('3. Executor (Super Admin) calls timelock.execute() to perform upgrade')
    Logger.log('4. Canceller (Super Admin) can abort via timelock.cancel() if needed')

    return true
}

export default func
func.tags = ['UpgradeTimelock']
func.id = 'deploy_timelock'
