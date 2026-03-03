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

    // Get the deployer signer
    const [deployer] = await ethers.getSigners()

    // ========== Deploy FunctionsAccessControl ==========
    const FunctionsAccessControl = await ethers.getContractFactory('FunctionsAccessControl')

    const [functionsAccessControlAddress, _] = await deploymentManager.deployContract(
        'FunctionsAccessControl',
        FunctionsAccessControl,
        [deployer.address]
    )

    // Verify FunctionsAccessControl deployment
    const functionsAccessControl = await ethers.getContractAt('FunctionsAccessControl', functionsAccessControlAddress)
    const DEFAULT_ADMIN_ROLE = ethers.ZeroHash
    const hasAdminRole = await functionsAccessControl.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)
    Logger.log('Deployer has DEFAULT_ADMIN_ROLE', hasAdminRole.toString(), 1)

    // Verify the contract on live networks
    if (network.name !== 'hardhat' && network.name !== 'localhost' && network.name !== 'virtual_mainnet') {
        try {
            Logger.log('Verifying on Etherscan...', undefined, 1)
            await hre.run('verify:verify', {
                address: functionsAccessControlAddress,
                constructorArguments: [deployer.address]
            })
            Logger.success('FunctionsAccessControl verified', undefined, 1)
        } catch (error: any) {
            if (error.message.includes('Already Verified') || error.message.includes('already verified')) {
                Logger.info('FunctionsAccessControl already verified', undefined, 1)
            } else if (error.message.includes('does not have bytecode')) {
                Logger.warning('Verification pending', 'Contract not yet indexed', 1)
            } else {
                Logger.warning('Verification failed', 'Verify manually later', 1)
            }
        }
    }

    Logger.deploymentSuccess('FunctionsAccessControl', functionsAccessControlAddress)

    // ========== Deploy PriceOracle ==========
    const PriceOracle = await ethers.getContractFactory('PriceOracle')

    const priceDecimals = 2
    const tolerancePercent = 200
    const maxStaleness = 86400

    Logger.log('Price decimals', priceDecimals.toString(), 1)
    Logger.log('Tolerance', (tolerancePercent / 100).toFixed(2) + '%', 1)
    Logger.log('Max staleness', (maxStaleness / 3600).toFixed(0) + ' hours', 1)

    const [priceOracleAddress, __] = await deploymentManager.deployContract(
        'PriceOracle',
        PriceOracle,
        [functionsAccessControlAddress, priceDecimals, tolerancePercent, maxStaleness]
    )

    // Verify PriceOracle deployment
    const priceOracle = await ethers.getContractAt('PriceOracle', priceOracleAddress)
    const tolerance = await priceOracle.tolerancePercent()
    const decimals = await priceOracle.priceDecimals()
    const staleness = await priceOracle.maxStaleness()

    Logger.log('Config verified - decimals', decimals.toString(), 1)
    Logger.log('Config verified - tolerance', (Number(tolerance) / 100).toFixed(2) + '%', 1)
    Logger.log('Config verified - staleness', (Number(staleness) / 3600).toFixed(0) + ' hours', 1)

    // Verify the contract on live networks
    if (network.name !== 'hardhat' && network.name !== 'localhost' && network.name !== 'virtual_mainnet') {
        try {
            Logger.log('Verifying on Etherscan...', undefined, 1)
            await hre.run('verify:verify', {
                address: priceOracleAddress,
                constructorArguments: [functionsAccessControlAddress, priceDecimals, tolerancePercent, maxStaleness]
            })
            Logger.success('PriceOracle verified', undefined, 1)
        } catch (error: any) {
            if (error.message.includes('Already Verified') || error.message.includes('already verified')) {
                Logger.info('PriceOracle already verified', undefined, 1)
            } else if (error.message.includes('does not have bytecode')) {
                Logger.warning('Verification pending', 'Contract not yet indexed', 1)
            } else {
                Logger.warning('Verification failed', 'Verify manually later', 1)
            }
        }
    }

    Logger.deploymentSuccess('PriceOracle', priceOracleAddress)

    return true
}

export default func
func.tags = ['PriceOracle', 'FunctionsAccessControl']
func.id = 'deploy_price_oracle'
