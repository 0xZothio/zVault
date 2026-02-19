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

    // Get the deployer signer
    const [deployer] = await ethers.getSigners()
    Logger.log('Deployer address', deployer.address, 1)

    // ========== Deploy FunctionsAccessControl ==========
    Logger.section('Deploying FunctionsAccessControl')

    const FunctionsAccessControl = await ethers.getContractFactory('FunctionsAccessControl')

    // Deploy without proxy (simple contract)
    const [functionsAccessControlAddress, _] = await deploymentManager.deployContract(
        'FunctionsAccessControl',
        FunctionsAccessControl,
        [deployer.address] // initialAdmin
    )

    // Verify FunctionsAccessControl deployment
    const functionsAccessControl = FunctionsAccessControl.attach(functionsAccessControlAddress)

    const DEFAULT_ADMIN_ROLE = ethers.ZeroHash
    const hasAdminRole = await functionsAccessControl.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)
    Logger.log('Deployer has DEFAULT_ADMIN_ROLE', hasAdminRole.toString(), 1)

    const PRICE_ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes('PRICE_ADMIN_ROLE'))
    const hasPriceAdminRole = await functionsAccessControl.hasRole(PRICE_ADMIN_ROLE, deployer.address)
    Logger.log('Deployer has PRICE_ADMIN_ROLE', hasPriceAdminRole.toString(), 1)

    const CONFIG_ROLE = ethers.keccak256(ethers.toUtf8Bytes('CONFIG_ROLE'))
    const hasConfigRole = await functionsAccessControl.hasRole(CONFIG_ROLE, deployer.address)
    Logger.log('Deployer has CONFIG_ROLE', hasConfigRole.toString(), 1)

    // Verify the contract on live networks
    if (network.name !== 'hardhat' && network.name !== 'localhost' && network.name !== 'virtual_mainnet') {
        try {
            Logger.log('Verifying FunctionsAccessControl on Etherscan...', undefined, 1)
            await hre.run('verify:verify', {
                address: functionsAccessControlAddress,
                constructorArguments: [deployer.address]
            })
            Logger.success('FunctionsAccessControl verified on Etherscan', undefined, 1)
        } catch (error: any) {
            if (error.message.includes('Already Verified')) {
                Logger.info('FunctionsAccessControl already verified', undefined, 1)
            } else {
                Logger.error('Failed to verify FunctionsAccessControl', error, 1)
            }
        }
    }

    Logger.deploymentSuccess('FunctionsAccessControl', functionsAccessControlAddress)

    // ========== Deploy PriceOracle ==========
    Logger.section('Deploying PriceOracle')

    const PriceOracle = await ethers.getContractFactory('PriceOracle')

    // Get config from manager
    const config = await deploymentManager.getConfig()

    const priceDecimals = 2  // 2 decimals for price input
    const tolerancePercent = 200  // 2% tolerance (200 basis points)
    const maxStaleness = 86400  // 24 hours in seconds (price considered stale after this)
    const firewallAddress = config.hypernativeFirewall || ethers.ZeroAddress

    if (firewallAddress === ethers.ZeroAddress) {
        throw new Error('Hypernative firewall address is required. Please set hypernativeFirewall in config.')
    }

    Logger.log('Price decimals', priceDecimals.toString(), 1)
    Logger.log('Tolerance percent', (tolerancePercent / 100).toFixed(2) + '%', 1)
    Logger.log('Max staleness', (maxStaleness / 3600).toFixed(0) + ' hours', 1)
    Logger.log('Firewall address', firewallAddress, 1)

    // Deploy without proxy (simple contract)
    const [priceOracleAddress, __] = await deploymentManager.deployContract(
        'PriceOracle',
        PriceOracle,
        [
            functionsAccessControlAddress,  // _accessControl
            priceDecimals,                   // _priceDecimals
            tolerancePercent,                // _tolerancePercent
            maxStaleness,                    // _maxStaleness
            firewallAddress                  // _firewall
        ]
    )

    // Verify PriceOracle deployment
    const priceOracle = PriceOracle.attach(priceOracleAddress)
    const tolerance = await priceOracle.tolerancePercent()
    const decimals = await priceOracle.priceDecimals()
    const staleness = await priceOracle.maxStaleness()

    Logger.log('Verified - Price decimals', decimals.toString(), 1)
    Logger.log('Verified - Tolerance percent', (Number(tolerance) / 100).toFixed(2) + '%', 1)
    Logger.log('Verified - Max staleness', (Number(staleness) / 3600).toFixed(0) + ' hours', 1)

    // Verify the contract on live networks
    if (network.name !== 'hardhat' && network.name !== 'localhost' && network.name !== 'virtual_mainnet') {
        try {
            Logger.log('Verifying PriceOracle on Etherscan...', undefined, 1)
            await hre.run('verify:verify', {
                address: priceOracleAddress,
                constructorArguments: [
                    functionsAccessControlAddress,
                    priceDecimals,
                    tolerancePercent,
                    maxStaleness,
                    firewallAddress
                ]
            })
            Logger.success('PriceOracle verified on Etherscan', undefined, 1)
        } catch (error: any) {
            if (error.message.includes('Already Verified')) {
                Logger.info('PriceOracle already verified', undefined, 1)
            } else {
                Logger.error('Failed to verify PriceOracle', error, 1)
            }
        }
    }

    Logger.deploymentSuccess('PriceOracle', priceOracleAddress)

    // ========== Summary ==========
    Logger.section('Deployment Summary')
    Logger.log('FunctionsAccessControl', functionsAccessControlAddress, 1)
    Logger.log('PriceOracle', priceOracleAddress, 1)
    Logger.log('Initial Admin (all roles)', deployer.address, 1)
    Logger.success('All contracts deployed successfully!', undefined, 1)

    return true
}

export default func
func.tags = ['PriceOracle', 'FunctionsAccessControl']
func.id = 'deploy_price_oracle'
