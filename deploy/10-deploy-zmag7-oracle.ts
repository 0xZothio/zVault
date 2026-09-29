import { ethers } from 'hardhat'
import { DeployFunction } from 'hardhat-deploy/types'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeploymentManager } from '../deployment-manager/DeploymentManager'
import { Logger } from '../utils/logger'
import { MAG7_LAUNCH } from './lib/mag7'

/**
 * Deploy MAG7 PriceOracle and a dedicated FunctionsAccessControl for it.
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { network } = hre

    const deploymentManager = new DeploymentManager(network.name, hre)
    await deploymentManager.initialize()

    const [deployer] = await ethers.getSigners()

    const FunctionsAccessControl = await ethers.getContractFactory('FunctionsAccessControl')
    const [functionsAccessControlAddress] = await deploymentManager.deployContract(
        'MAG7FunctionsAccessControl',
        FunctionsAccessControl,
        [deployer.address]
    )

    if (network.name !== 'hardhat' && network.name !== 'localhost') {
        Logger.log('Waiting for contract indexing...', undefined, 1)
        await new Promise((resolve) => setTimeout(resolve, 5000))
    }

    const functionsAccessControl = await ethers.getContractAt(
        'FunctionsAccessControl',
        functionsAccessControlAddress
    )
    const DEFAULT_ADMIN_ROLE = ethers.ZeroHash
    try {
        const hasAdminRole = await functionsAccessControl.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)
        Logger.log('Deployer has MAG7 FunctionsAccessControl DEFAULT_ADMIN_ROLE', hasAdminRole.toString(), 1)
    } catch {
        Logger.warning('Could not verify role', 'Contract not yet indexed', 1)
    }

    const PriceOracle = await ethers.getContractFactory('PriceOracle')
    const priceDecimals = MAG7_LAUNCH.oraclePriceDecimals
    const tolerancePercent = MAG7_LAUNCH.oracleToleranceBps
    const maxStaleness = MAG7_LAUNCH.oracleMaxStalenessSec

    Logger.log('Price decimals', priceDecimals.toString(), 1)
    Logger.log('Tolerance', (tolerancePercent / 100).toFixed(2) + '%', 1)
    Logger.log('Max staleness', (maxStaleness / 3600).toFixed(0) + ' hours', 1)

    const [priceOracleAddress] = await deploymentManager.deployContract(
        'MAG7PriceOracle',
        PriceOracle,
        [functionsAccessControlAddress, priceDecimals, tolerancePercent, maxStaleness]
    )

    const priceOracle = await ethers.getContractAt('PriceOracle', priceOracleAddress)
    const initialPrice = MAG7_LAUNCH.oracleInitialPriceRaw
    const currentPrice = await priceOracle.currentPrice()

    if (currentPrice === 0n) {
        Logger.log('Setting MAG7 initial price', '$1.0000', 1)
        const tx = await priceOracle.setPrice(initialPrice)
        await tx.wait()
        const newPrice = await priceOracle.currentPrice()
        Logger.success('Initial MAG7 price set', ethers.formatEther(newPrice) + ' (base18)', 1)
    } else {
        Logger.info('MAG7 price already set', ethers.formatEther(currentPrice) + ' (base18)', 1)
    }

    if (network.name !== 'hardhat' && network.name !== 'localhost' && network.name !== 'virtual_mainnet') {
        try {
            Logger.log('Verifying MAG7FunctionsAccessControl on explorer...', undefined, 1)
            await hre.run('verify:verify', {
                address: functionsAccessControlAddress,
                constructorArguments: [deployer.address],
            })
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error)
            if (message.includes('Already Verified') || message.includes('already verified')) {
                Logger.info('MAG7FunctionsAccessControl already verified', undefined, 1)
            } else {
                Logger.warning('MAG7FunctionsAccessControl verification pending', 'Verify manually later', 1)
            }
        }

        try {
            Logger.log('Verifying MAG7PriceOracle on explorer...', undefined, 1)
            await hre.run('verify:verify', {
                address: priceOracleAddress,
                constructorArguments: [
                    functionsAccessControlAddress,
                    priceDecimals,
                    tolerancePercent,
                    maxStaleness,
                ],
            })
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error)
            if (message.includes('Already Verified') || message.includes('already verified')) {
                Logger.info('MAG7PriceOracle already verified', undefined, 1)
            } else {
                Logger.warning('MAG7PriceOracle verification pending', 'Verify manually later', 1)
            }
        }
    }

    Logger.deploymentSuccess('MAG7PriceOracle', priceOracleAddress)
    return true
}

export default func
func.tags = ['MAG7PriceOracle', 'MAG7FunctionsAccessControl', 'MAG7']
func.id = 'deploy_mag7_price_oracle'
func.dependencies = ['MAG7Confirm']
